import assert from 'node:assert/strict';
import test from 'node:test';
import { Material } from '../engine/material.js';
import { Mesh } from '../engine/mesh.js';
import { traceDirectionalShadowFaces, getDirectionalShadowBvhBuildCount } from '../engine/raytracing.js';
import { DirectionalLight } from '../engine/light.js';
import { Scene } from '../engine/scene.js';

test('mesh rebuilds render data only for geometry or UV changes', () => {
    const mesh = Mesh.createCube(new Material());
    const initialRevision = mesh.renderDataRevision;

    mesh.selectedFace = 2;
    assert.equal(mesh.dirtyFlags.selection, true);
    assert.equal(mesh.rebuildRenderData(), false);
    assert.equal(mesh.renderDataRevision, initialRevision);
    mesh.updateRenderQueues();

    mesh.faceColors[0][0] = 0.5;
    assert.equal(mesh.dirtyFlags.materials, true);
    assert.equal(mesh.rebuildRenderData(), false);
    assert.equal(mesh.renderDataRevision, initialRevision);

    mesh.positions[0][0] -= 0.1;
    assert.equal(mesh.dirtyFlags.geometry, true);
    assert.equal(mesh.rebuildRenderData(), true);
    assert.equal(mesh.renderDataRevision, initialRevision + 1);

    mesh.faceUvs[0][0][0] += 0.1;
    assert.equal(mesh.dirtyFlags.uvs, true);
    assert.equal(mesh.rebuildRenderData(), true);
    assert.equal(mesh.renderDataRevision, initialRevision + 2);
});

test('scene reports mesh membership and directional-light dirtiness', () => {
    const scene = new Scene();
    scene.consumeDirtyFlags();
    const mesh = Mesh.createCube(new Material());

    scene.add(mesh);
    assert.equal(scene.dirtyFlags.geometry, true);
    scene.consumeDirtyFlags();
    scene.light.direction[0] = 0.25;
    assert.equal(scene.dirtyFlags.light, true);
});

test('shadow BVH is reused for light changes and rebuilt for mesh geometry', () => {
    const scene = new Scene();
    const mesh = Mesh.createCube(new Material());
    scene.add(mesh);
    const light = new DirectionalLight();

    traceDirectionalShadowFaces(scene, light);
    assert.equal(getDirectionalShadowBvhBuildCount(scene), 1);
    light.direction[0] += 0.2;
    traceDirectionalShadowFaces(scene, light);
    assert.equal(getDirectionalShadowBvhBuildCount(scene), 1);

    mesh.positions[0][0] += 0.1;
    mesh.rebuildRenderData();
    traceDirectionalShadowFaces(scene, light);
    assert.equal(getDirectionalShadowBvhBuildCount(scene), 2);
});

test('skinning signature changes with pose and remains stable otherwise', () => {
    const mesh = Mesh.createCube(new Material());
    const bone = mesh.skeleton.addBone('Root');
    mesh.setVertexBoneWeight(0, 0, bone, 1);
    const initial = mesh.getSkinningSignature();

    assert.equal(mesh.getSkinningSignature(), initial);
    bone.rotation[1] = 0.25;
    assert.notEqual(mesh.getSkinningSignature(), initial);
});

test('stable skinning skips uploads and clearing weights restores bind buffers', () => {
    const mesh = Mesh.createCube(new Material());
    const bone = mesh.skeleton.addBone('Root');
    mesh.setVertexBoneWeight(0, 0, bone, 1);
    mesh.positionBuffer = {};
    mesh.normalBuffer = {};
    let boundBuffer = null;
    const uploads = [];
    const gl = {
        ARRAY_BUFFER: 1,
        DYNAMIC_DRAW: 2,
        bindBuffer: (_target, buffer) => { boundBuffer = buffer; },
        bufferData: (_target, data) => uploads.push({ buffer: boundBuffer, data })
    };

    assert.equal(mesh.updateSkinningBuffers(gl), true);
    assert.equal(uploads.length, 2);
    assert.equal(mesh.updateSkinningBuffers(gl), false);
    assert.equal(uploads.length, 2);
    assert.equal(mesh.clearVertexBoneWeights(0, 0), true);
    assert.equal(mesh.updateSkinningBuffers(gl), true);
    assert.equal(uploads.length, 4);
    assert.equal(uploads[2].data, mesh.vertices);
    assert.equal(uploads[3].data, mesh.normals);
});
