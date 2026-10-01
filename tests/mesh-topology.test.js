import assert from 'node:assert/strict';
import test from 'node:test';
import { Material } from '../engine/material.js';
import { Mesh } from '../engine/mesh.js';

const material = () => new Material();

test('cube uses shared vertices and derives edge adjacency', () => {
    const cube = Mesh.createCube(material());

    assert.equal(cube.positions.length, 8);
    assert.equal(cube.faces.length, 6);
    assert.equal(cube.edges.length, 12);
    assert.ok([...cube.facesOfEdge.values()].every(adjacentFaces => adjacentFaces.length === 2));
    assert.ok(cube.edgesOfVertex.every(vertexEdges => vertexEdges.length === 3));
});

test('extruding a cube face adds indexed cap and side faces', () => {
    const cube = Mesh.createCube(material());

    cube.extrudeFace(4, 0.25);

    assert.equal(cube.positions.length, 12);
    assert.equal(cube.faces.length, 11);
    assert.equal(cube.edges.length, 20);
});

test('nearby vertices weld into shared topology', () => {
    const mesh = new Mesh(material());
    mesh.setTopology(
        [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0.04, 0, 0], [1, 1, 0], [0, 1, 1]],
        [[0, 1, 2], [3, 4, 5]]
    );
    mesh.rebuildRenderData();

    assert.equal(mesh.weldNearbyVertices(0, 0, 0.1), true);
    assert.equal(mesh.positions.length, 5);
    assert.equal(mesh.faces[0][0], mesh.faces[1][0]);
});

test('reading the compatibility view does not weld disconnected vertices', () => {
    const mesh = new Mesh(material());
    mesh.setTopology(
        [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 0], [-1, 0, 0], [0, -1, 0]],
        [[0, 1, 2], [3, 4, 5]]
    );
    mesh.rebuildRenderData();

    assert.equal(mesh.polygons.length, 2);
    mesh.rebuildRenderData();
    assert.equal(mesh.positions.length, 6);
    assert.notEqual(mesh.faces[0][0], mesh.faces[1][0]);
});

test('indexed skinning supports weighted and unweighted corners', () => {
    const cube = Mesh.createCube(material());
    const bone = cube.skeleton.addBone('Root');

    assert.equal(cube.setVertexBoneWeight(0, 0, bone, 1), true);
    assert.deepEqual(cube.getDeformedPoint(0), cube.positions[0]);
    assert.equal(cube.getDeformedVertices().length, cube.faces.flat().length * 3);
    assert.equal(cube.getDeformedNormals().length, cube.faces.flat().length * 3);
});

test('coplanar adjacent faces merge into one n-gon', () => {
    const mesh = new Mesh(material());
    mesh.setTopology(
        [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
        [[0, 1, 2], [0, 2, 3]]
    );
    mesh.rebuildRenderData();

    assert.equal(mesh.mergeCoplanarFace(0), true);
    assert.equal(mesh.faces.length, 1);
    assert.equal(mesh.faces[0].length, 4);
});

test('legacy polygon JSON imports shared positions and corner UVs', () => {
    const mesh = new Mesh(material());
    mesh.polygons = [
        [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
        [[0.00005, 0, 0], [1, 1, 0], [0, 1, 0]]
    ];
    mesh.faceUvs = [[[0, 0], [1, 0], [1, 1]], [[0, 0], [1, 1], [0, 1]]];
    mesh.rebuildRenderData();

    assert.equal(mesh.positions.length, 4);
    assert.deepEqual(mesh.faces, [[0, 1, 2], [0, 2, 3]]);
    assert.deepEqual(mesh.faceUvs[1][2], [0, 1]);
});

test('editing one shared vertex updates every incident face', () => {
    const mesh = new Mesh(material());
    mesh.setTopology(
        [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
        [[0, 1, 2], [0, 2, 3]]
    );
    mesh.rebuildRenderData();

    mesh.setVertexPosition(0, [0.25, 0, 0]);

    assert.deepEqual(mesh.positions[0], [0.25, 0, 0]);
    assert.equal(mesh.polygons[0][0], mesh.polygons[1][0]);
    assert.deepEqual(mesh.polygons[1][0], [0.25, 0, 0]);
});
