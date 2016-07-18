const path = require('path');
const fs = require('fs');

const mockfs = require('mock-fs');
const toArray = require('stream-to-array');
const BemEntityName = require('bem-entity-name');
const BemNaming = require('bem-naming');

const lib = require('../');

const chai = require('chai');
chai.should();

it('should return stream of files with contents', function() {
    return checkFn({
        files: ['l1/f1.js', 'l1/f2.js'],
        fsFiles: {'l1/f1.js': '1', 'l1/f2.js': '2'},
        result: {'l1/f1.js': '1', 'l1/f2.js': '2'}
    });
});

it('should return stream of files without contents if read=false', function() {
    return checkFn({
        files: ['l1/f1.js', 'l1/f2.js'],
        fsFiles: {'l1/f1.js': '1', 'l1/f2.js': '2'},
        options: {read: false},
        result: {'l1/f1.js': null, 'l1/f2.js': null}
    });
});

afterEach(mockfs.restore);

function checkFn(opts) {
    const fsFiles = opts.fsFiles || opts.files.reduce((res, f, idx) => (res[f] = String(idx), res), {});
    mockfs(fsFiles);

    opts.options || (opts.options = {read: true});
    opts.files = opts.files.map(makeFileEntity);

    return toArray(lib.filesToStream(opts.files, opts.options))
        .then(res => {
            res.reduce((res, f) => (res[f.path] = f.contents && String(f.contents), res), {}).should.eql(opts.result);
        });
}

function makeFileEntity(filepath) {
    const level = filepath.split('/')[0];
    const tech = path.basename(filepath).split('.').slice(1).join('.');
    const entityName = path.basename(filepath).split('.')[0];
    const entity = new BemEntityName(BemNaming.parse(entityName));
    return {entity, level, tech, path: filepath};
}
