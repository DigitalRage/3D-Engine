import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createDefaultAudioSceneConfig,
    normalizeAudioAction,
    normalizeAudioManifest,
    normalizeAudioSceneConfig,
    shouldUseDirectMediaPlayback
} from '../engine/audio.js';

test('audio manifest keeps only valid OGG entries and generates stable IDs', () => {
    const manifest = normalizeAudioManifest({ version: 1, assets: [
        { path: 'city.ogg' },
        { id: 'jump', name: 'Jump', path: 'fx/jump.ogg', tags: ['sfx'] },
        { id: 'bad', path: 'music.mp3' },
        null
    ] });
    assert.equal(manifest.assets.length, 2);
    assert.equal(manifest.assets[0].id, 'city');
    assert.equal(manifest.assets[1].id, 'jump');
    assert.deepEqual(manifest.assets[1].tags, ['sfx']);
});

test('audio action normalization clamps settings and supports queue/spatial cues', () => {
    const cue = normalizeAudioAction({
        action: 'player.jump',
        soundId: 'jump',
        mode: 'queue',
        volume: 2,
        cooldown: -1,
        maxVoices: 999,
        playbackRateMin: 1.5,
        playbackRateMax: 0.5,
        spatial: true,
        position: ['2', 3, 4]
    });
    assert.equal(cue.mode, 'queue');
    assert.equal(cue.volume, 1);
    assert.equal(cue.cooldown, 0);
    assert.equal(cue.maxVoices, 64);
    assert.equal(cue.playbackRateMin, 0.5);
    assert.equal(cue.playbackRateMax, 1.5);
    assert.deepEqual(cue.position, [2, 3, 4]);
});

test('scene audio config merges safely with defaults', () => {
    const config = normalizeAudioSceneConfig({
        masterVolume: 0.25,
        music: { soundId: 'theme', crossfade: 2 },
        actions: [{ action: 'player.jump', soundId: 'jump' }]
    });
    assert.equal(config.version, 1);
    assert.equal(config.masterVolume, 0.25);
    assert.equal(config.music.soundId, 'theme');
    assert.equal(config.music.loop, true);
    assert.equal(config.actions.length, 1);
    assert.deepEqual(Object.keys(createDefaultAudioSceneConfig().buses), ['music', 'sfx', 'ui', 'voice']);
});

test('the packaged song id is stable and playable by manifest path', () => {
    const manifest = normalizeAudioManifest({ version: 1, assets: [
        { path: 'Hic Svnt Leones Loop.ogg', name: 'Hic Svnt Leones Loop' }
    ] });
    assert.equal(manifest.assets[0].id, 'hic-svnt-leones-loop');
    assert.equal(manifest.assets[0].path, 'Hic Svnt Leones Loop.ogg');
});


test('packaged file:// audio uses direct media playback fallback', () => {
    assert.equal(shouldUseDirectMediaPlayback('file:///engine/assets/sound/theme.ogg', 'file:///engine/index.html'), true);
    assert.equal(shouldUseDirectMediaPlayback('./assets/sound/theme.ogg', 'http://localhost:8080/index.html'), false);
    assert.equal(shouldUseDirectMediaPlayback('blob:http://localhost:8080/test', 'http://localhost:8080/index.html'), false);
});

test('packaged built-in audio resolves to embedded data media on file pages', async () => {
    const source = await import('../engine/audio.js');
    const manifest = source.normalizeAudioManifest({ version: 1, assets: [
        { id: 'hic', name: 'Hic Svnt Leones Loop', path: 'Hic Svnt Leones Loop.ogg', builtin: true }
    ]});
    assert.equal(manifest.assets[0].builtin, true);
    assert.equal(source.shouldUseDirectMediaPlayback('data:audio/ogg;base64,AAAA'), true);
    assert.equal(source.shouldUseDirectMediaPlayback('blob:https://example.test/audio'), false);
});

test('built-in audio resolver returns embedded OGG data independent of page protocol', async () => {
    const { AudioManager } = await import('../engine/audio.js');
    const originalDocument = globalThis.document;
    globalThis.document = { baseURI: 'https://example.test/' };
    try {
        const manager = Object.create(AudioManager.prototype);
        manager.baseUrl = './assets/sound/';
        const resolved = manager.resolveUrl({ builtin: true, path: 'Hic Svnt Leones Loop.ogg' });
        assert.equal(resolved.startsWith('data:audio/ogg;base64,'), true);
        assert.ok(resolved.length > 3000000);
    } finally {
        globalThis.document = originalDocument;
    }
});
