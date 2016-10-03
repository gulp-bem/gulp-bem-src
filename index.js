'use strict';

const assert = require('assert');
const path = require('path');

const fs = require('graceful-fs');
const inParallel = require('run-parallel-limit');
const BemEntityName = require('bem-entity-name');
const bemConfig = require('bem-config');
const walk = require('bem-walk');
const File = require('vinyl');
const toArray = require('stream-to-array');
const thru = require('through2');

const deps = require('@bem/deps');

module.exports = src;

src.filesToStream = filesToStream;
src.harvest = harvest;

/**
 * Функция для получения файлов по декларации.
 *
 * Алгоритм используется следующий:
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

    const techMap = Object.assign({}, options.techMap);
    Object.keys(techMap)
        .filter(t => !Array.isArray(techMap[t]))
        .forEach(t => { techMap[t] = [techMap[t]]; });

    // Получаем слепок файловой структуры с уровней
    const introspectionP = Promise.resolve(config.levelMap ? config.levelMap() : {})
        .then(levelMap => {
            const intro = walk(sources, {levels: levelMap});

            let hasSomeData = false;
            intro.on('data', () => { hasSomeData = true; });
            return new Promise((resolve, reject) => {
                setTimeout(() => hasSomeData ||
                    reject('Looks like there are no files. ' +
                        'See also https://github.com/bem-sdk/bem-walk/issues/76'), 1000);
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
    const depsData = introspectionP
        .then(files => files
            // Получаем deps.js
            .filter(f => f.tech === 'deps.js')
            // Сортируем по уровням
            .sort((f1, f2) => (sources.indexOf(f1.level) - sources.indexOf(f2.level))))
        // Читаем и исполняем
        .then(deps.read())
        .then(deps.parse());

    // Получаем граф с помощью bem-deps
    const graphP = depsData.then(deps.buildGraph);

    // Раскрываем декларацию с помощью графа
    const filedeclP = graphP
        .then(graph => {
            const fulldecl = graph.dependenciesOf(decl, tech);
            fulldecl.forEach(fe => {
                fe.entity = new BemEntityName(fe.entity);
            });
            return fulldecl;
        });

    if (options.deps === true) {
        const stream = thru.obj();
        filedeclP.then(fulldecl => {
            const f = v => {
                const res = {};
                v.tech && (res.tech = v.tech);
                v.entity.block && (res.block = v.entity.block);
                v.entity.elem && (res.elem = v.entity.elem);
                v.entity.mod.name && (res.mod = v.entity.mod.name, res.val = v.entity.mod.val); // eslint-disable-line
                return res;
            };
            stream.push(new File({
                name: '',
                path: 'name.deps.js',
                contents: new Buffer(require('util').inspect(fulldecl.map(f),
                    {depth: null, breakLength: 100, maxArrayLength: null}))
            }));
            stream.push(null);
        })
        .catch(console.error);
        return stream;
    }

    const fullfiledeclP = filedeclP
        // Преобразуем технологии зависимостей в декларации в технологии файловой системы
        .then(fulldecl => _multiflyTechs(fulldecl, techMap));

    // Формируем упорядоченный список файлов по раскрытой декларации и интроспекции
    const orderedFilesPromise = Promise.all([introspectionP, fullfiledeclP])
        .then(data => {
            const introspection = data[0];
            const filedecl = data[1];

            return harvest(introspection, sources, filedecl);
        });

    // Читаем файлы из списка в поток
    return filesToStream(orderedFilesPromise, options);
}

/**
 * @param {BemFile[]|Promise<BemFile[]>} filesPromise - result of previous step © cap obv
 * @param {Object} options - see src options
 * @returns {Stream<Vinyl>}
 */
function filesToStream(filesPromise, options) {
    const stream = thru.obj();

    options = Object.assign({
        read: true
    }, options);

    Promise.resolve(filesPromise)
        .then(files => new Promise((resolve) => {
            const vfiles = [];
            files.forEach(file => {
                const vf = new File({
                    name: '',
                    base: file.level,
                    path: file.path,
                    contents: null
                });

                vf.name = path.basename(file.path).split('.')[0];
                vf.tech = file.tech;
                vf.level = file.level;
                vf.entity = file.entity;

                vfiles.push(vf);
                stream.push(vf);
            });

            if (!options.read) {
                stream.push(null);
                resolve();
                return;
            }

            _readFiles(files.map(f => f.path), {encoding: options.encoding, limit: options.limit}, (err, res) => {
                if (err) {
                    console.error(err.stack);
                    stream.emit('error', err);
                    stream.push(null);
                    resolve();
                    return;
                }
                res.forEach((contents, k) => { vfiles[k].contents = contents; });
                stream.push(null);
                resolve();
            });

        }))
        .catch(err => {
            stream.emit('error', err);
            stream.push(null);
        });

    return stream;
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

function _multiflyTechs(decl, techMap) {
    return decl.reduce((res, fileEntity) => {
        const techs = techMap[fileEntity.tech] || (techMap[fileEntity.tech] = [fileEntity.tech]);
        techs.forEach(tech => res.push(Object.assign({}, fileEntity, {tech})));
        return res;
    }, []);
}

function _readFiles(files, opts, cb) {
    if (!files.length) {
        return cb(null, []);
    }

    opts || (opts = {});
    typeof opts === 'string' && (opts = {encoding: opts});
    //console.log(fs.readdirSync(path.dirname(files[0])), files[0]);
    inParallel(files.map(f => (next =>
        tryCatch(() => fs.readFile(f, opts, next), e => {
            console.log('??zxczxc', e);
            next(e);
        }))),
            opts.limit || 1, cb);
}

function tryCatch(fn, cb) {
    try {
        return fn();
    } catch(e) {
        return cb(e);
    }
}
