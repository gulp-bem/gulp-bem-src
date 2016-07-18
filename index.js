const bemConfig = require('bem-config');
const walk = require('bem-walk');
const File = require('vinyl');
const toArray = require('stream-to-array');

module.exports = src;

/*
src(decl: Tenorok[], techs: String|String[], [, options: {
  config: ?BemConfig, // Should be loaded from .bemrc by default
  sources: ?String[], // Should use levels from config by default and throw if nothing found
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
 * @param {Tenorok[]} decl - entities to harvest
 * @param {String|String[]} techs - desired techs
 * @param {Object} options
 * @param {?BemConfig} options.config - config to use instead of default .bemrc
 * @param {?(String[])} options.sources - levels to use to search files
 * @param {?Object<String, String[]>} options.techAliases - tech to aliases map to fit needs for everyone
 * @returns {Stream<Vinyl>} - Just a typical stream of gulp-like file objects
 */
function src(decl, techs, options) {
    const config = options.config || bemConfig();

    config.levelMap()
        // walk levels
        .then(levelMap => {
            const levels = options.sources || Object.keys(levelMap);
            return toArray(walk(levels, {levels: levelMap}));
        })
        .then(introspetion => {
            console.log(introspetion);
        });
    // harvest(introspetion, );
}

src.harvest = harvest;

/**
 * @param {Array<{entity: Tenorok, level: String, tech: String, path: String}>} introspection - unordered file-entities list
 * @param {String[]} levels - ordered levels' paths list
 * @param {Tenorok[]} decl - resolved and ordered declaration
 * @returns {Array<{entity: Tenorok, level: String, tech: String, path: String}>} - resulting ordered file-entities list
 */
function harvest(introspection, levels, decl) {
    const hash = fileEntity => fileEntity.entity.id + '.' + fileEntity.tech;
    const declIndex = _buildIndex(decl, hash);

    const entityInIndex = file => declIndex[hash(file)] !== undefined;
    return introspection
        .filter(entityInIndex)
        .filter(file => levels.indexOf(file.level) !== -1)
        .sort((f1, f2) => f1.entity.id === f2.entity.id
            ? levels.indexOf(f1.level) - levels.indexOf(f2.level)
            : declIndex[f2.entity.id] - declIndex[f1.entity.id]);
};

/**
 * @param {Array<{entity: Tenorok, tech: String}>} list - List of tenoroks
 * @returns {Object<String, Number>} - Entity id to sort order
 */
function _buildIndex(list, hash) {
    return list.reduce((res, fileEntity, idx) => {
        res[hash(fileEntity)] = idx;
        return res;
    }, {});
}
