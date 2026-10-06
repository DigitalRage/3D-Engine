import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerCharacter } from '../engine/player.js';

test('player character is a low-poly rigged silhouette', () => {
  const player = new PlayerCharacter();
  assert.ok(player.mesh.triangleCount >= 980 && player.mesh.triangleCount <= 1020);
  assert.ok(player.mesh.skeleton.bones.length >= 16);
  assert.ok(player.mesh.vertexWeights.size > 0);
  assert.ok(player.animations.walk && player.animations.run && player.animations.jump && player.animations.fall);
  const eyeFaces = player.mesh.faceColors.filter(color => color[0] > 0.9 && color[1] > 0.9 && color[2] > 0.9);
  assert.equal(eyeFaces.length, 20);
});

test('player body mesh is outward-facing while eyes remain front-facing', () => {
  const player = new PlayerCharacter();
  let signedVolume = 0;
  for (const face of player.mesh.faces) {
    const a = player.mesh.positions[face[0]], b = player.mesh.positions[face[1]], c = player.mesh.positions[face[2]];
    signedVolume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  assert.ok(signedVolume > 0.01);
  const eyeZ = player.mesh.positions[player.mesh.faces[player.mesh.faces.length - 1][0]][2];
  assert.ok(eyeZ < -0.25);
});

test('arrow camera turn does not rotate the player, and movement follows camera-relative direction', () => {
  const player = new PlayerCharacter();
  player.body = { velocity: [0,0,0], grounded: true };
  const camera = { position: [0,1.5,4.8], target: [0,1.1,0], far: 700 };
  const input = { isDown: code => code === 'ArrowRight', mouseButtons: { 0:false, 2:false }, mouseDelta: [0,0] };
  player.postPhysics(0.1, input, camera);
  assert.ok(player.cameraYaw > 0);
  assert.equal(player.yaw, 0);
  const before = player.yaw;
  player.postPhysics(0.1, { isDown: () => false, mouseButtons: {0:true,2:false}, mouseDelta: [100,0] }, camera);
  assert.equal(player.yaw, before);

  player.prePhysics(0.1, { isDown: code => code === 'KeyW' });
  assert.ok(player.body.velocity[0] < 0, 'W should move in the camera-relative forward direction after turning right');
  assert.ok(player.body.velocity[2] < 0);
  assert.ok(player.yaw > 0 && player.yaw < 0.3, 'player should turn toward travel direction');
});


test('player closed body sections have a coherent outward winding', () => {
  const player = new PlayerCharacter();
  const p = player.mesh.positions;
  let volume = 0;
  for (const face of player.mesh.faces) {
    if (face.length < 3) continue;
    const a = p[face[0]], b = p[face[1]], c = p[face[2]];
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  assert.ok(volume > 0.5, `expected outward positive volume, got ${volume}`);
});

test('player walking animation changes the skinned pose', () => {
  const player = new PlayerCharacter();
  player.mesh.animationPlayer.play(player.animations.walk, 0.2);
  const before = player.mesh.getDeformedVertices();
  player.mesh.animationPlayer.seek(0.6);
  const after = player.mesh.getDeformedVertices();
  let difference = 0;
  for (let i = 0; i < before.length; i++) difference += Math.abs(before[i] - after[i]);
  assert.ok(difference > 0.5);
});
