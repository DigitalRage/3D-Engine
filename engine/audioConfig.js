export const AUDIO_MANIFEST_VERSION = 1;
export const AUDIO_SCENE_VERSION = 1;
export const AUDIO_BUSES = ['music', 'sfx', 'ui', 'voice'];

export function shouldUseDirectMediaPlayback(mediaUrl, baseUri = globalThis.document?.baseURI || 'http://localhost/') {
    try {
        const protocol = new URL(mediaUrl, baseUri).protocol;
        return protocol === 'file:' || protocol === 'data:';
    } catch {
        const value = String(mediaUrl || '');
        return value.startsWith('file:') || value.startsWith('data:');
    }
}

export function createDefaultAudioSceneConfig() {
    return {
        version: AUDIO_SCENE_VERSION,
        masterVolume: 1,
        masterMuted: false,
        buses: {
            music: { volume: 0.75, muted: false },
            sfx: { volume: 1, muted: false },
            ui: { volume: 0.8, muted: false },
            voice: { volume: 1, muted: false }
        },
        music: {
            soundId: null,
            autoplay: true,
            loop: true,
            volume: 1,
            crossfade: 0.65,
            playbackRate: 1
        },
        actions: []
    };
}

export function normalizeAudioSceneConfig(input = {}) {
    const defaults = createDefaultAudioSceneConfig();
    const source = input && typeof input === 'object' ? input : {};
    const buses = source.buses && typeof source.buses === 'object' ? source.buses : {};
    const music = source.music && typeof source.music === 'object' ? source.music : {};
    return {
        version: AUDIO_SCENE_VERSION,
        masterVolume: clamp01(source.masterVolume ?? defaults.masterVolume),
        masterMuted: !!(source.masterMuted ?? defaults.masterMuted),
        buses: Object.fromEntries(AUDIO_BUSES.map(bus => [bus, {
            volume: clamp01(buses[bus]?.volume ?? defaults.buses[bus].volume),
            muted: !!(buses[bus]?.muted ?? defaults.buses[bus].muted)
        }])),
        music: {
            soundId: typeof music.soundId === 'string' && music.soundId ? music.soundId : null,
            autoplay: music.autoplay !== false,
            loop: music.loop !== false,
            volume: clamp01(music.volume ?? defaults.music.volume),
            crossfade: clampNumber(music.crossfade ?? defaults.music.crossfade, 0, 30),
            playbackRate: clampNumber(music.playbackRate ?? defaults.music.playbackRate, 0.25, 4)
        },
        actions: Array.isArray(source.actions) ? source.actions.map(normalizeAudioAction).filter(Boolean) : []
    };
}

export function normalizeAudioAction(action = {}) {
    if (!action || typeof action !== 'object') return null;
    const actionName = String(action.action || '').trim();
    const soundId = String(action.soundId || '').trim();
    if (!actionName || !soundId) return null;
    return {
        id: String(action.id || `cue-${slugify(actionName)}-${slugify(soundId)}`),
        action: actionName,
        soundId,
        bus: AUDIO_BUSES.includes(action.bus) ? action.bus : 'sfx',
        mode: ['overlap', 'queue', 'replace'].includes(action.mode) ? action.mode : 'overlap',
        volume: clamp01(action.volume ?? 1),
        loop: !!action.loop,
        cooldown: clampNumber(action.cooldown ?? 0, 0, 3600),
        maxVoices: clampNumber(action.maxVoices ?? 8, 1, 64),
        playbackRateMin: Math.min(clampNumber(action.playbackRateMin ?? 1, 0.25, 4), clampNumber(action.playbackRateMax ?? 1, 0.25, 4)),
        playbackRateMax: Math.max(clampNumber(action.playbackRateMin ?? 1, 0.25, 4), clampNumber(action.playbackRateMax ?? 1, 0.25, 4)),
        spatial: !!action.spatial,
        position: Array.isArray(action.position) && action.position.length >= 3
            ? [Number(action.position[0]) || 0, Number(action.position[1]) || 0, Number(action.position[2]) || 0]
            : null
    };
}

export function normalizeAudioManifest(manifest = {}) {
    const source = manifest && typeof manifest === 'object' ? manifest : {};
    if (source.version !== undefined && Number(source.version) !== AUDIO_MANIFEST_VERSION) {
        throw new TypeError(`Unsupported audio manifest version: ${source.version}`);
    }
    const assets = Array.isArray(source.assets) ? source.assets : [];
    const normalized = [];
    const ids = new Set();
    for (const entry of assets) {
        if (!entry || typeof entry !== 'object') continue;
        const path = String(entry.path || entry.url || '').trim();
        if (!path || !/\.ogg(?:$|\?)/i.test(path)) continue;
        const id = String(entry.id || slugify(path.replace(/^.*\//, '').replace(/\.ogg$/i, ''))).trim();
        if (!id || ids.has(id)) continue;
        ids.add(id);
        normalized.push({
            id,
            name: String(entry.name || id),
            path,
            loopable: entry.loopable !== false,
            tags: Array.isArray(entry.tags) ? entry.tags.map(tag => String(tag)).filter(Boolean) : [],
            volume: clamp01(entry.volume ?? 1),
            builtin: entry.builtin === true,
            local: entry.local === true
        });
    }
    return { version: AUDIO_MANIFEST_VERSION, assets: normalized };
}


function clamp01(value) {
    return Math.min(1, Math.max(0, Number(value) || 0));
}

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));
}

function slugify(value) {
    return String(value || 'sound').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sound';
}
