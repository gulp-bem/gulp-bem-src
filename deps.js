'use strict';

const fsp = require('mz/fs');

const decl = require('bem-decl');
// const deps = require('@bem/deps');
const depsFormatFulfill = require('@bem/deps/lib/formats/deps.js/fulfill');
const _eval = require('node-eval');
const BemGraph = require('bem-graph').BemGraph;
const BemEntityName = require('bem-entity-name');

const declNormalize = decl.normalizer('normalize2');
const declFulfill = function(nd, scope) {
    // TODO: использовать здесь deps
    nd = depsFormatFulfill(nd, scope);
    nd.entity = new BemEntityName(nd.entity);
    return nd;
}

module.exports = {
    read,
    parse,
    buildGraph
};

/**
 * Serially reads and evaluates BemFiles.
 *
 * @param {Array<BemFile>} files - file data to read
 * @returns {Promise<Array<{file: BemFile, data: *, scope: BemEntityName}>>} [description]
 */
function read(files) {
    const res = [];
    const stack = [].concat(files);
    let i = 0;

    return new Promise(
        function next(resolve, reject) {
            if (i >= stack.length) {
                resolve(res);
                return;
            }

            const f = stack[i++];
            fsp.readFile(f.path, 'utf8')
                .then(content => res.push(Object.assign(f, {
                    data: _eval(content, f.path)
                })))
                .then(() => next(resolve, reject))
                .catch(reject);
        });
}

/**
 * @param {Array<{entity: BemEntityName, scope: {entity, tech: String}, data: *}>} depsData - List of deps
 * @returns {Array<*>}
 */
function parse(depsData) {
    const mustDeps = [];
    const shouldDeps = [];
    const mustDepsIndex = {};
    const shouldDepsIndex = {};

    depsData.forEach(record => {
        const scope = record.scope || { entity: record.entity };
        const data = [].concat(record.data);

        data.forEach(dep => {
            if (dep.mustDeps) {
                declNormalize(dep.mustDeps).forEach(function (nd) {
                    nd = declFulfill(nd, scope);
                    const key = declKey(nd);
                    if (!mustDepsIndex[key]) {
                        mustDeps.push({vertex: scope, dependOn: nd, ordered: true});
                        mustDepsIndex[key] = true;
                    }
                });
            }
            if (dep.shouldDeps) {
                declNormalize(dep.shouldDeps).forEach(function (nd) {
                    nd = declFulfill(nd, scope);
                    const key = declKey(nd);
                    if (!shouldDepsIndex[key]) {
                        shouldDeps.push({vertex: scope, dependOn: nd});
                        shouldDepsIndex[key] = true;
                    }
                });
            }
            if (dep.noDeps) {
                declNormalize(dep.noDeps).forEach(function (nd) {
                    nd = declFulfill(nd, scope);
                    removeFromDeps(nd, mustDepsIndex, mustDeps);
                    removeFromDeps(nd, shouldDepsIndex, shouldDeps);
                });
            }
        });
    });

    function declKey(nd) {
        return nd.tech ? `${nd.entity.id}.${nd.tech}` : nd.entity.id;
    }

    function removeFromDeps(decl, index, list) {
        const key = declKey(decl);
        if (index[key]) {
            for (var i = 0, l = list.length; i < l; i++) {
                if (declKey(list[i].vertex) === key) {
                    return list.splice(i, 1);
                }
            }
        } else {
            index[key] = true;
        }
        return null;
    }

    return mustDeps.concat(shouldDeps);
}

/**
 * @param {Array<{vertex: Tenorok, dependOn: Tenorok, ordered: Boolean}>} deps - List of deps
 * @returns {BemGraph}
 */
function buildGraph(deps) {
    const graph = new BemGraph();

    deps.forEach(dep => {
        const vertex = graph.vertex(dep.vertex.entity, dep.vertex.tech);

        dep.ordered
            ? vertex.dependsOn(dep.dependOn.entity, dep.dependOn.tech)
            : vertex.linkWith(dep.dependOn.entity, dep.dependOn.tech);
    });

    return graph;
}
