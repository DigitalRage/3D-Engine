import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerCharacter } from '../engine/player.js';

test('player character is a low-poly rigged silhouette', () => {
  const player = new PlayerCharacter();
  assert.ok(player.mesh.triangleCount >= 900 && player.mesh.triangleCount <= 1100);
  assert.ok(player.mesh.skeleton.bones.length >= 16);
  assert.ok(player.mesh.vertexWeights.size > 0);
  assert.ok(player.animations.walk && player.animations.run && player.animations.jump && player.animations.fall);
  const eyeFaces = player.mesh.faceColors.filter(color => color[0] > 0.9 && color[1] > 0.9 && color[2] > 0.9);
  assert.equal(eyeFaces.length, 20);
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
