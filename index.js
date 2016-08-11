'use strict';

const assert = require('assert');
const path = require('path');

const BemEntityName = require('bem-entity-name');
const bemConfig = require('bem-config');
const walk = require('bem-walk');
const File = require('vinyl');
const toArray = require('stream-to-array');
const thru = require('through2');
const read = require('gulp-read');
const bubbleStreamError = require('bubble-stream-error');

const deps = require('@bem/deps');

module.exports = src;

src.filesToStream = filesToStream;
src.harvest = harvest;

/*
src(sources: String[], decl: BemEntityName[], techs: String|String[], [, options: {
  config: ?BemConfig, // Should be loaded from .bemrc by default
  techAliases: ?Object<String,String[]> // Should use aliases from .bemrc if any

  // vfs.src options:
  buffer: Boolean=true,
  read: Boolean=true,
  since: ?(Date|Number),
  stripBOM: Boolean=true,
  passthrough: Boolean=false,
  sourcemaps: Boolean=false,
  followSymlinks: Boolean=true, // we should pass it to bem-walk?
  dots: Boolean=false // pointless?,
  // etc.
}]): Stream<Vinyl>
*/

/**
 * - Получаем слепок файловой структуры с уровней
 * - Получаем и исполняем содержимое файлов ?.deps.js (получаем набор объектов deps)
 * - Получаем граф с помощью bem-deps
 * - Сортируем по уровням и раскрываем декларацию с помощью графа
 * - Преобразуем технологии зависимостей в декларации в технологии файловой системы
 * - Формируем упорядоченный список файлов по раскрытой декларации и интроспекции
 * - Читаем файлы из списка в поток
 *
 * techAliases: {[depsTech]: fileTechs}
 *
 * @param {String[]} sources - levels to use to search files
 * @param {BemEntityName[]} decl - entities to harvest
 * @param {String} tech - desired tech
 * @param {Object} options - options
 * @param {?BemConfig} options.config - config to use instead of default .bemrc
 * @param {?Object<String, String[]>} options.techAliases - tech to aliases map to fit needs for everyone
 * @returns {Stream<Vinyl>} - Just a typical stream of gulp-like file objects
 */
function src(sources, decl, tech, options) {
    assert(Array.isArray(sources) && sources.length, 'Sources required to get some files');
    assert(Array.isArray(decl) && decl.length, 'Declaration required to harvest some entities');
    assert(tech && typeof tech === 'string', 'Tech required and should be a string to build exactly some');

    options || (options = {});
    options.techMap || (options.techMap = {});

    const config = options.config || bemConfig();

    // Получаем слепок файловой структуры с уровней
    const introspection = Promise.resolve(config.levelMap ? config.levelMap() : {})
        .then(levelMap => {
            const intro = walk(sources, {levels: levelMap});

            let hasSomeData = false;
            intro.on('data', () => { hasSomeData = true; });
            return new Promise((resolve, reject) => {
                setTimeout(() => hasSomeData ||
                    reject('bem-walk timeout. See also https://github.com/bem-sdk/bem-walk/issues/76'), 1000);
                toArray(intro).then(resolve).catch(reject);
            });
        })
        .then(files => {
            files.forEach(fe => {
                fe.entity = new BemEntityName(fe.entity);
            });
            return files;
        });

    // Получаем и исполняем содержимое файлов ?.deps.js (получаем набор объектов deps)
    const depsData = introspection.then(files =>
        files
            // Получаем deps.js
            .filter(f => f.tech === 'deps.js')
            // Сортируем по уровням
            .sort((f1, f2) => (sources.indexOf(f1.level) - sources.indexOf(f2.level))))
        // Читаем и исполняем
        .then(deps.read())
        .then(deps.parse());

    // Получаем граф с помощью bem-deps
    const graph = depsData.then(deps.buildGraph);
    // Раскрываем декларацию с помощью графа
    const filedecl = graph
        .then(graph => {
            const fulldecl = graph.dependenciesOf(decl, tech);
            fulldecl.forEach(fe => {
                fe.entity = new BemEntityName(fe.entity);
            });
            return fulldecl;
        })
        // Преобразуем технологии зависимостей в декларации в технологии файловой системы
        .then(fulldecl => _multiflyTechs(fulldecl, (options.techMap && options.techMap[tech]) || [tech]));

    // Формируем упорядоченный список файлов по раскрытой декларации и интроспекции
    const orderedFilesPromise = Promise.all([introspection, filedecl])
        .then(data => {
            const introspection = data[0];
            const filedecl = data[1];

            return harvest(introspection, sources, filedecl);
        });

    // Читаем файлы из списка в поток
    return filesToStream(orderedFilesPromise, options);
}

/**
 * @param {BemFile[]|Promise<BemFile[]>} files - result of previous step © your cap
 * @param {Object} options - see src options
 * @returns {Stream<Vinyl>}
 */
function filesToStream(files, options) {
    const stream = thru.obj();

    options = Object.assign({
        read: true
        // bem: false
    }, options);

    Promise.resolve(files)
        .then(files => new Promise((resolve) => {
            let i = 0;
            const l = files.length;

            (function next() {
                if (i >= l) {
                    stream.push(null);
                    resolve();
                    return;
                }

                const file = files[i++];
                const vf = new File({
                    name: '',
                    base: file.level,
                    path: file.path,
                    contents: null
                });

                // if (options.bem) {
                    vf.name = path.basename(file.path).split('.')[0];
                    vf.tech = file.tech;
                    vf.level = file.level;
                // }

                stream.push(vf);
                process.nextTick(next);
            }());
        }))
        .catch(err => {
            stream.emit('error', err);
            stream.push(null);
        });

    let result = stream;

    if (options.read) {
        const reader = read();
        bubbleStreamError(stream, reader);
        result = stream.pipe(reader);
    }

    return result;
}

/**
 * @param {Array<{entity: BemEntityName, level: String, tech: String, path: String}>} introspection - unordered file-entities list
 * @param {String[]} levels - ordered levels' paths list
 * @param {Tenorok[]} decl - resolved and ordered declaration
 * @returns {Array<{entity: BemEntityName, level: String, tech: String, path: String}>} - resulting ordered file-entities list
 */
function harvest(introspection, levels, decl/*: Array<{entity, tech}>*/) {
    const hash = fileEntity => `${fileEntity.entity.id}.${fileEntity.tech}`;
    const declIndex = _buildIndex(decl, hash);

    const entityInIndex = file => declIndex[hash(file)] !== undefined;
    return introspection
        .filter(entityInIndex)
        .filter(file => levels.indexOf(file.level) !== -1)
        .sort((f1, f2) => hash(f1) === hash(f2)
            ? levels.indexOf(f1.level) - levels.indexOf(f2.level)
            : declIndex[hash(f1)] - declIndex[hash(f2)]);
}

/**
 * @param {Array<{entity: Tenorok, tech: String}>} list - List of tenoroks
 * @param {Function} hash - Hashing function
 * @returns {Object<String, Number>} - Entity id to sort order
 */
function _buildIndex(list, hash) {
    return list.reduce((res, fileEntity, idx) => {
        res[hash(fileEntity)] = idx;
        return res;
    }, {});
}

function _multiflyTechs(decl, techs) {
    Array.isArray(techs) || (techs = [techs]);
    return decl.reduce((res, fileEntity) => {
        techs.forEach(tech => res.push(Object.assign({}, fileEntity, {tech})));
        return res;
    }, []);
}
