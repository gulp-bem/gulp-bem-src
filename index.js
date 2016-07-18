module.exports = {
    buildFilesList
};

/**
 * @param {Array<{entity: Tenorok, level: String, tech: String, path: String}>} introspection - unordered file-entities list
 * @param {String[]} levels - ordered levels' paths list
 * @param {Tenorok[]} decl - resolved and ordered declaration
 * @returns {Array<{entity: Tenorok, level: String, tech: String, path: String}>} - resulting ordered file-entities list
 */
function buildFilesList(introspection, levels, decl) {
    const declIndex = buildIndex(decl);
    console.log(declIndex);
    return introspection
        .filter(file => declIndex[file.entity.id] !== undefined)
        .filter(file => levels.indexOf(file.level) !== -1)
        .sort((f1, f2) => f1.entity.id === f2.entity.id
            ? levels.indexOf(f2.level) - levels.indexOf(f1.level)
            : declIndex[f2.entity.id] - declIndex[f1.entity.id]);
};

/**
 * @param {Tenorok[]} decl
 */
function buildIndex(list) {
    // Object<Tenorok.id, SortOrder>
    return list.reduce((res, entity, idx) => {
        res[entity.id] = idx;
        return res;
    }, {});
}
