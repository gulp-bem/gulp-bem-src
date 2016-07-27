const path = require('path');

const mockfs = require('mock-fs');
const BemEntityName = require('bem-entity-name');
const BemNaming = require('bem-naming');
const _eval = require('node-eval');

const lib = require('../deps');

const chai = require('chai');
chai.should();

describe('read', function() {

    it('should return files for entities in decl without deps', check({
        files: {
            'l1/b2/b2.deps.js': `[{shouldDeps: {block: 'b3'}}]`,
        },
        introspection: ['l1/b2/b2.deps.js'],
        result: ['l1/b2/b2.deps.js']
    }));

    it('should return something', check({
        files: {
            'l1/b1/b1.deps.js': `[{shouldDeps: {block: 'b2'}}]`,
            'l1/b2/b2.deps.js': `[{shouldDeps: {block: 'b3'}}]`,
            'l1/b3/b3.deps.js': `[{shouldDeps: {block: 'b4'}}]`,
            'l1/b1/b1.js': `1`
        },
        introspection: ['l1/b3/b3.deps.js', 'l1/b1/b1.deps.js', 'l1/b2/b2.deps.js'],
        result: ['l1/b3/b3.deps.js', 'l1/b1/b1.deps.js', 'l1/b2/b2.deps.js']
    }));

    function check(opts) {
        return () => {
            mockfs(opts.files);

            const result = opts.result
                .map(makeFileEntity)
                .map(f => ({path: f.path, data: _eval(opts.files[f.path])}));

            return lib.read(opts.introspection.map(makeFileEntity))
                .then(res => res.map(f => ({path: f.path, data: f.data})).should.eql(result));
        };
    }

    afterEach(mockfs.restore);
});

describe('parse', function() {

    it('should return files for entities in decl without deps', check({
        deps: [
            { path: 'l1/b1/b1.deps.js', data: {shouldDeps: {block: 'b2'}} }
        ],
        result: [{vertex: {entity: {block: 'b1'}}, dependOn: {entity: {block: 'b2'}}}]
    }));

    it('should return something', check({
        deps: [
            { path: 'l1/b1/b1.deps.js', data: {shouldDeps: {block: 'b2'}} },
            { path: 'l1/b2/b2.deps.js', data: {mustDeps: {block: 'b3'}} },
            { path: 'l1/b3/b3.deps.js', data: {shouldDeps: {block: 'b4'}, mustDeps: {block: 'b1'}} }
        ],
        result: [
            {vertex: {entity: {block: 'b2'}}, dependOn: {entity: {block: 'b3'}}, ordered: true},
            {vertex: {entity: {block: 'b3'}}, dependOn: {entity: {block: 'b1'}}, ordered: true},
            {vertex: {entity: {block: 'b1'}}, dependOn: {entity: {block: 'b2'}}},
            {vertex: {entity: {block: 'b3'}}, dependOn: {entity: {block: 'b4'}}},
        ]
    }));

    function check(opts) {
        return () => {
            const deps = opts.deps.map(makeFileEntity);
            const result = opts.result;

            const res = lib.parse(deps);

            res.map(f => {
                f.vertex.entity = f.vertex.entity.valueOf();
                f.dependOn.entity = f.dependOn.entity.valueOf();
                return f;
            })
                .should.eql(result.map(f => {
                    f.dependOn.tech = f.dependOn.tech || null;
                    return f;
                }));
        };
    }
});

describe('graph', function() {

    it('should return files for entities in decl without deps', function() {
        lib.buildGraph([
            {vertex: {entity: {block: 'b2'}}, dependOn: {entity: {block: 'b3'}}, ordered: true},
            {vertex: {entity: {block: 'b3'}}, dependOn: {entity: {block: 'b1'}}, ordered: true},
            {vertex: {entity: {block: 'b1'}}, dependOn: {entity: {block: 'b2'}}},
            {vertex: {entity: {block: 'b3'}}, dependOn: {entity: {block: 'b4'}}},
        ]);

        // hm
    });

});

function makeFileEntity(file) {
    file = typeof file === 'string' ? {path: file} : file;
    file.level = file.level || file.path.split('/')[0];
    file.tech = path.basename(file.path).split('.').slice(1).join('.');
    file.entity = new BemEntityName(file.entity || BemNaming.parse(path.basename(file.path).split('.')[0]));
    return file;
}
