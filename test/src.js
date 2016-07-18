const path = require('path');
const fs = require('fs');

const mockfs = require('mock-fs');
const toArray = require('stream-to-array');
const BemEntityName = require('bem-entity-name');
const BemNaming = require('bem-naming');

const lib = require('../');

const chai = require('chai');
chai.should();

it('should return something', function() {
    return checkSrc({
        files: ['l1/b2/b2.js', 'l2/b1/b1.js', 'l2/b1/b1.css', 'l1/b1/b1.js', 'l2/b1/b1.es'],
        decl: ['b1', 'b2'],
        levels: ['l1', 'l2'],
        techs: ['js', 'es'],
        result: ['l1/b1/b1.js', 'l2/b1/b1.js', 'l2/b1/b1.es', 'l1/b2/b2.js']
    });
});

afterEach(mockfs.restore);

function checkSrc(opts) {
    const files = opts.files.reduce((res, f, idx) => (res[f] = String(idx), res), {});
    mockfs(files);

    opts.decl = opts.decl.map(makeEntity);
    opts.result = opts.result.map(makeFileEntity);

    const config = {
        levelMap: () => Promise.resolve(
            opts.levels.reduce((res, path) => (res[path] = {}, res), {})),
    };

    return lib(opts.levels, opts.decl, opts.techs, {config})
        .then(res => {
            console.log(res.map(normalize))
            res.map(normalize).should.eql(opts.result.map(normalize));
        });
}

function makeFileEntity(filepath) {
    const level = filepath.split('/')[0];
    const tech = path.basename(filepath).split('.').slice(1).join('.');
    const entityName = path.basename(filepath).split('.')[0];
    const entity = new BemEntityName(BemNaming.parse(entityName));
    return {entity, level, tech, path: filepath};
}
function makeEntity(str) {
    str = str.split('.');
    const entityName = str[0];
    const tech = str[1];
    const entity = new BemEntityName(BemNaming.parse(entityName));
    return tech ? {entity, tech} : {entity};
}
function normalize(fileEntity) {
    fileEntity.entity.id && (fileEntity.entity = '[object BemEntityName:' + fileEntity.entity.id + ']');
    return fileEntity;
}
