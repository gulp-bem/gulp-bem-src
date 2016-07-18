const BemEntityName = require('bem-entity-name');
const BemNaming = require('bem-naming');
const path = require('path');
const chai = require('chai');
const lib = require('../');

chai.should();

it('should works', function() {
    checkBuildFilesList({
        files: ['l1/b1/b1.js', 'l1/b2/b2.css', 'l1/b3/b3.js'],
        levels: ['l1'],
        decl: ['b2.css'],
        result: ['l1/b2/b2.css']
    });
});

// ['b1/b1.js', 'b2/b2.js', 'b3/b3.js']
// {entity: {block: 'button'}, tech: 'css'}

// should do something

it('');

function checkBuildFilesList(opts) {
    opts.files = opts.files.map(makeFileEntity);
    opts.result = opts.result.map(makeFileEntity);
    opts.decl = opts.decl.map(makeEntity);

    lib.buildFilesList(opts.files, opts.levels, opts.decl)
        .should.eql(opts.result.map(e => (e.entity.id, e)));
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
    return new BemEntityName(BemNaming.parse(entityName));
}
