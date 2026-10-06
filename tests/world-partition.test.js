import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldPartition } from '../engine/worldPartition.js';

test('world partition loads a local ring and honors concurrent load limits', async () => {
    const events = [];
    const partition = new WorldPartition({ cellSize: 100, loadRadius: 1, unloadRadius: 2, maxConcurrentLoads: 1 });
    for (let z = -2; z <= 2; z++) {
        for (let x = -2; x <= 2; x++) {
            partition.registerCell(`${x},${z}`, {
                x, z,
                load: async () => { events.push(`load:${x},${z}`); },
                unload: async () => { events.push(`unload:${x},${z}`); }
            });
        }
    }
    partition.update([0, 0, 0]);
    assert.equal(partition.stats.loading, 1);
    await Promise.all([...partition.loading.values()]);
    // The remaining eight cells in the radius-1 disk are queued, not started at once.
    assert.ok(partition.stats.queuedLoads > 0);
    while (partition.loadQueue.length || partition.loading.size) {
        partition.update([0, 0, 0]);
        await Promise.all([...partition.loading.values()]);
    }
    assert.equal(partition.stats.loaded, 5);
    assert.equal(events.filter(event => event.startsWith('load:')).length, 5);
});

test('world partition uses unload hysteresis instead of boundary thrashing', async () => {
    const unloaded = [];
    const partition = new WorldPartition({ cellSize: 100, loadRadius: 0, unloadRadius: 2 });
    partition.registerCell('origin', { x: 0, z: 0, load: async () => {}, unload: async () => unloaded.push('origin') });
    partition.registerCell('far', { x: 3, z: 0, load: async () => {}, unload: async () => unloaded.push('far') });

    await partition.loadCell('origin');
    assert.equal(partition.stats.loaded, 1);
    partition.update([199, 0, 0]); // Still in cell 1, origin is exactly two cells away from center, retained.
    await Promise.resolve();
    assert.deepEqual(unloaded, []);
    partition.update([300, 0, 0]);
    await Promise.all([...partition.unloading.values()]);
    assert.deepEqual(unloaded, ['origin']);
});
