/**
 * OGG-first audio system for the editor and runtime.
 *
 * Features:
 * - Manifest-backed sounds from ./assets/sound/index.json
 * - Lazy Web Audio initialization (autoplay-policy friendly)
 * - Master + music/sfx/ui/voice buses with independent volume/mute
 * - Music playback with looping, queueing, and crossfades
 * - One-shot playback with polyphony limits and cooldowns
 * - Action/event cues: overlap, queue, or replace behavior
 * - 2D panning and optional 3D spatial audio
 * - Playback handles with pause/resume/seek/stop/fade controls
 * - Scene configuration that serializes cleanly to scene JSON
 */

export const AUDIO_MANIFEST_VERSION = 1;
export const AUDIO_SCENE_VERSION = 1;
export const AUDIO_BUSES = ['music', 'sfx', 'ui', 'voice'];

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
            volume: clamp01(entry.volume ?? 1)
        });
    }
    return { version: AUDIO_MANIFEST_VERSION, assets: normalized };
}

export class AudioManager {
    constructor({
        manifestUrl = './assets/sound/index.json',
        baseUrl = './assets/sound/',
        maxPolyphony = 32
    } = {}) {
        this.manifestUrl = manifestUrl;
        this.baseUrl = baseUrl;
        this.maxPolyphony = Math.max(1, Math.floor(maxPolyphony));
        this.manifest = { version: AUDIO_MANIFEST_VERSION, assets: [] };
        this.assets = new Map();
        this.playbacks = new Set();
        this.queues = new Map();
        this.actionCues = new Map();
        this.musicPlayback = null;
        this.masterGain = null;
        this.compressor = null;
        this.buses = new Map();
        this.context = null;
        this.listener = null;
        this._audioUnlocked = false;
        this._unlockInstalled = false;
        this._playbackId = 0;
        this.onError = null;
        this.ready = this.loadManifest();
        this.installUnlockListeners();
    }

    async loadManifest(url = this.manifestUrl) {
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const manifest = normalizeAudioManifest(await response.json());
            this.setManifest(manifest);
        } catch (error) {
            this.setManifest({ version: AUDIO_MANIFEST_VERSION, assets: [] });
            this.onError?.(error);
            console.warn('Audio manifest unavailable; the engine will still run.', error);
        }
        return this.manifest;
    }

    setManifest(manifest) {
        this.manifest = normalizeAudioManifest(manifest);
        this.assets = new Map(this.manifest.assets.map(asset => [asset.id, asset]));
        return this.manifest;
    }

    mergeManifestAssets(entries = []) {
        const current = this.listSounds();
        const merged = [...current, ...(Array.isArray(entries) ? entries : [])];
        this.setManifest({ version: AUDIO_MANIFEST_VERSION, assets: merged });
        return this.manifest;
    }

    listSounds() {
        return [...this.assets.values()];
    }

    getSound(id) {
        return this.assets.get(id) || null;
    }

    resolveUrl(asset) {
        const path = typeof asset === 'string' ? asset : asset?.path;
        if (!path) return null;
        try {
            return new URL(path, new URL(this.baseUrl, document.baseURI)).href;
        } catch {
            return path;
        }
    }

    ensureContext() {
        if (this.context) return this.context;
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Context) throw new Error('Web Audio is not supported in this browser');
        this.context = new Context({ latencyHint: 'interactive' });
        this.compressor = this.context.createDynamicsCompressor();
        this.compressor.threshold.value = -8;
        this.compressor.knee.value = 12;
        this.compressor.ratio.value = 6;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.18;
        this.masterGain = this.context.createGain();
        this.masterGain.gain.value = 1;
        this.masterGain.connect(this.compressor).connect(this.context.destination);
        for (const bus of ['master', ...AUDIO_BUSES]) this.ensureBus(bus);
        this.applyBusState();
        if (this.listener) this.updateListener(this.listener);
        return this.context;
    }

    ensureBus(name) {
        if (name === 'master') return this.masterGain;
        if (this.buses.has(name)) return this.buses.get(name).gain;
        const gain = this.context.createGain();
        gain.connect(this.masterGain);
        this.buses.set(name, { gain, volume: 1, muted: false });
        return gain;
    }

    installUnlockListeners() {
        if (this._unlockInstalled || typeof window === 'undefined') return;
        this._unlockInstalled = true;
        const unlock = () => { this.unlock(); };
        window.addEventListener('pointerdown', unlock, { passive: true, once: false });
        window.addEventListener('keydown', unlock, { passive: true, once: false });
    }

    async unlock() {
        try {
            const context = this.ensureContext();
            if (context.state !== 'running') await context.resume();
            this._audioUnlocked = context.state === 'running';
            if (this._audioUnlocked) {
                for (const playback of this.playbacks) {
                    if (playback.state === 'blocked') playback.resume();
                }
            }
            return this._audioUnlocked;
        } catch (error) {
            this.onError?.(error);
            return false;
        }
    }

    isUnlocked() {
        return this._audioUnlocked || this.context?.state === 'running';
    }

    setMasterVolume(value) {
        this._masterVolume = clamp01(value);
        this.applyBusState();
    }

    setMasterMuted(muted) {
        this._masterMuted = !!muted;
        this.applyBusState();
    }

    setBusVolume(bus, value) {
        if (bus === 'master') return this.setMasterVolume(value);
        const state = this.getBusState(bus);
        state.volume = clamp01(value);
        this.applyBusState();
    }

    setBusMuted(bus, muted) {
        if (bus === 'master') return this.setMasterMuted(muted);
        const state = this.getBusState(bus);
        state.muted = !!muted;
        this.applyBusState();
    }

    getBusState(bus) {
        if (!this._busState) this._busState = new Map();
        if (!this._busState.has(bus)) this._busState.set(bus, { volume: 1, muted: false });
        return this._busState.get(bus);
    }

    applyBusState() {
        if (!this.context || !this.masterGain) return;
        const masterVolume = clamp01(this._masterVolume ?? 1);
        this.masterGain.gain.setTargetAtTime(this._masterMuted ? 0 : masterVolume, this.context.currentTime, 0.012);
        for (const [bus, { gain }] of this.buses) {
            const state = this.getBusState(bus);
            const value = state.muted ? 0 : state.volume;
            gain.gain.setTargetAtTime(value, this.context.currentTime, 0.012);
        }
    }

    createPlayback(soundId, options = {}) {
        const asset = this.getSound(soundId);
        if (!asset) throw new Error(`Unknown OGG sound: ${soundId}`);
        if (this.playbacks.size >= this.maxPolyphony) {
            const oldest = this.playbacks.values().next().value;
            oldest?.stop({ fade: 0.015 });
        }
        const context = this.ensureContext();
        const audio = new Audio();
        audio.preload = 'auto';
        audio.crossOrigin = 'anonymous';
        audio.src = this.resolveUrl(asset);
        audio.loop = !!options.loop;
        audio.playbackRate = clampNumber(options.playbackRate ?? 1, 0.25, 4);
        audio.volume = 1;
        if (Number.isFinite(options.startOffset)) audio.currentTime = Math.max(0, options.startOffset);

        const source = context.createMediaElementSource(audio);
        const busName = AUDIO_BUSES.includes(options.bus) ? options.bus : 'sfx';
        const busGain = this.ensureBus(busName);
        const gain = context.createGain();
        gain.gain.value = clamp01((options.volume ?? 1) * (asset.volume ?? 1));

        let tail = gain;
        let panner = null;
        if (options.spatial || Array.isArray(options.position)) {
            panner = context.createPanner();
            panner.panningModel = options.panningModel || 'HRTF';
            panner.distanceModel = options.distanceModel || 'inverse';
            panner.refDistance = Math.max(0.01, Number(options.refDistance) || 1);
            panner.maxDistance = Math.max(panner.refDistance, Number(options.maxDistance) || 100);
            panner.rolloffFactor = Math.max(0, Number(options.rolloffFactor) || 1);
            panner.coneInnerAngle = 360;
            panner.coneOuterAngle = 360;
            tail.connect(panner);
            tail = panner;
            this.setPlaybackPosition(panner, options.position || [0, 0, 0]);
        } else if (Number.isFinite(options.pan) && typeof context.createStereoPanner === 'function') {
            panner = context.createStereoPanner();
            panner.pan.value = Math.min(1, Math.max(-1, Number(options.pan)));
            tail.connect(panner);
            tail = panner;
        }
        source.connect(gain);
        tail.connect(busGain);

        const playback = new AudioPlayback(this, {
            id: `playback-${++this._playbackId}`,
            soundId,
            asset,
            audio,
            source,
            gain,
            panner,
            bus: busName,
            owner: options.owner || 'global',
            spatial: !!panner,
            fadeOutDefault: Number(options.fadeOut) || 0.08
        });
        this.playbacks.add(playback);
        playback.onFinished(() => this.playbacks.delete(playback));
        return playback;
    }

    play(soundId, options = {}) {
        const playback = this.createPlayback(soundId, options);
        playback.start(options.delay || 0);
        return playback;
    }

    preview(soundId, options = {}) {
        this.stopPreview();
        const playback = this.play(soundId, {
            ...options,
            bus: 'ui',
            owner: 'preview',
            loop: !!options.loop
        });
        this._preview = playback;
        playback.onFinished(() => { if (this._preview === playback) this._preview = null; });
        return playback;
    }

    stopPreview(fade = 0.06) {
        if (this._preview) this._preview.stop({ fade });
        this._preview = null;
    }

    playMusic(soundId, options = {}) {
        const crossfade = Math.max(0, Number(options.crossfade) || 0);
        const nextOptions = {
            ...options,
            bus: 'music',
            owner: options.owner || 'runtime',
            loop: options.loop !== false
        };
        const start = () => {
            const playback = this.play(soundId, nextOptions);
            this.musicPlayback = playback;
            playback.onFinished(() => {
                if (this.musicPlayback === playback) this.musicPlayback = null;
            });
            if (crossfade > 0) {
                playback.setVolume(0);
                playback.fadeTo(options.volume ?? 1, crossfade);
            }
            return playback;
        };
        const previous = this.musicPlayback;
        if (!previous) return start();
        previous.fadeTo(0, crossfade).then(() => previous.stop({ fade: 0 }));
        return start();
    }

    stopMusic({ fade = 0.35 } = {}) {
        const playback = this.musicPlayback;
        this.musicPlayback = null;
        return playback?.stop({ fade }) || false;
    }

    enqueue(soundId, options = {}) {
        const queueName = String(options.queueName || 'default');
        if (!this.queues.has(queueName)) this.queues.set(queueName, []);
        const queue = this.queues.get(queueName);
        const item = { id: `queue-${++this._playbackId}`, soundId, options: { ...options }, cancelled: false };
        queue.push(item);
        this.drainQueue(queueName);
        return {
            id: item.id,
            cancel: () => {
                item.cancelled = true;
                const index = queue.indexOf(item);
                if (index >= 0) queue.splice(index, 1);
            }
        };
    }

    async drainQueue(queueName) {
        const queue = this.queues.get(queueName);
        if (!queue || queue.running) return;
        queue.running = true;
        try {
            while (queue.length) {
                const item = queue.shift();
                if (!item || item.cancelled) continue;
                const playback = this.play(item.soundId, { ...item.options, queueName, owner: item.options.owner || 'runtime' });
                await playback.done;
            }
        } finally {
            queue.running = false;
            if (!queue.length) this.queues.delete(queueName);
        }
    }

    clearQueue(queueName = null) {
        if (queueName === null) {
            for (const queue of this.queues.values()) queue.length = 0;
            this.queues.clear();
            return;
        }
        this.queues.get(queueName)?.splice(0);
        this.queues.delete(queueName);
    }

    registerAction(action, soundId, options = {}) {
        const cue = normalizeAudioAction({ action, soundId, ...options });
        if (!cue) throw new Error('Action cue requires an action and sound ID');
        const entry = { ...cue, active: new Set(), lastTriggeredAt: -Infinity, lastPlayback: null };
        if (!this.actionCues.has(cue.action)) this.actionCues.set(cue.action, new Set());
        this.actionCues.get(cue.action).add(entry);
        return () => this.unregisterAction(entry);
    }

    unregisterAction(entry) {
        const set = this.actionCues.get(entry.action);
        if (!set) return false;
        set.delete(entry);
        if (!set.size) this.actionCues.delete(entry.action);
        return true;
    }

    configureScene(config = {}) {
        const normalized = normalizeAudioSceneConfig(config);
        this._masterVolume = normalized.masterVolume;
        this._masterMuted = normalized.masterMuted;
        for (const bus of AUDIO_BUSES) {
            const state = this.getBusState(bus);
            state.volume = normalized.buses[bus].volume;
            state.muted = normalized.buses[bus].muted;
        }
        this.applyBusState();
        this.actionCues.clear();
        this.clearQueue();
        normalized.actions.forEach(cue => {
            try { this.registerAction(cue.action, cue.soundId, cue); } catch (error) { this.onError?.(error); }
        });
        if (normalized.music.soundId && normalized.music.autoplay) {
            if (this.musicPlayback?.soundId !== normalized.music.soundId) {
                this.playMusic(normalized.music.soundId, {
                    loop: normalized.music.loop,
                    volume: normalized.music.volume,
                    crossfade: normalized.music.crossfade,
                    playbackRate: normalized.music.playbackRate,
                    owner: 'runtime'
                });
            } else {
                this.musicPlayback.setLoop(normalized.music.loop);
                this.musicPlayback.setVolume(normalized.music.volume);
                this.musicPlayback.setPlaybackRate(normalized.music.playbackRate);
            }
        } else {
            this.stopMusic({ fade: normalized.music.crossfade });
        }
        return normalized;
    }

    triggerAction(action, payload = {}) {
        const entries = this.actionCues.get(String(action));
        if (!entries?.size) return [];
        const now = performance.now() / 1000;
        const started = [];
        for (const entry of entries) {
            if (now - entry.lastTriggeredAt < entry.cooldown) continue;
            entry.active.forEach(playback => { if (playback.state === 'finished' || playback.state === 'stopped') entry.active.delete(playback); });
            if (entry.maxVoices && entry.active.size >= entry.maxVoices) continue;
            entry.lastTriggeredAt = now;
            const rate = randomRange(entry.playbackRateMin, entry.playbackRateMax);
            const position = payload.position || entry.position || null;
            const options = {
                owner: 'runtime',
                bus: entry.bus,
                volume: entry.volume,
                loop: entry.loop,
                playbackRate: rate,
                spatial: entry.spatial,
                position,
                ...(payload.audioOptions || {})
            };
            let playback;
            if (entry.mode === 'queue') {
                const queueName = `action:${entry.action}`;
                const queue = this.queues.get(queueName);
                if (entry.maxVoices && queue?.length >= entry.maxVoices) continue;
                const job = this.enqueue(entry.soundId, { ...options, queueName });
                started.push(job);
                continue;
            }
            if (entry.mode === 'replace') {
                entry.lastPlayback?.stop({ fade: 0.03 });
            }
            try {
                playback = this.play(entry.soundId, options);
                entry.lastPlayback = playback;
                entry.active.add(playback);
                playback.onFinished(() => entry.active.delete(playback));
                started.push(playback);
            } catch (error) {
                this.onError?.(error);
            }
        }
        return started;
    }

    stopAll({ owner = null, fade = 0.05 } = {}) {
        this.clearQueue();
        for (const playback of [...this.playbacks]) {
            if (owner === null || playback.owner === owner) playback.stop({ fade });
        }
        if (owner === null || this.musicPlayback?.owner === owner) this.musicPlayback = null;
    }

    pauseAll(owner = null) {
        for (const playback of this.playbacks) if (owner === null || playback.owner === owner) playback.pause();
    }

    resumeAll(owner = null) {
        for (const playback of this.playbacks) if (owner === null || playback.owner === owner) playback.resume();
    }

    setListenerFromCamera(camera) {
        if (!camera) return;
        const forward = normalize([
            camera.target[0] - camera.position[0],
            camera.target[1] - camera.position[1],
            camera.target[2] - camera.position[2]
        ]);
        const up = normalize(camera.up || [0, 1, 0]);
        this.updateListener({ position: camera.position, forward, up });
    }

    updateListener(listener) {
        this.listener = listener;
        if (!this.context?.listener) return;
        const target = this.context.listener;
        const position = listener.position || [0, 0, 0];
        const forward = listener.forward || [0, 0, -1];
        const up = listener.up || [0, 1, 0];
        if (target.positionX) {
            target.positionX.value = position[0];
            target.positionY.value = position[1];
            target.positionZ.value = position[2];
            target.forwardX.value = forward[0];
            target.forwardY.value = forward[1];
            target.forwardZ.value = forward[2];
            target.upX.value = up[0];
            target.upY.value = up[1];
            target.upZ.value = up[2];
        } else {
            target.setPosition?.(...position);
            target.setOrientation?.(forward[0], forward[1], forward[2], up[0], up[1], up[2]);
        }
    }

    setPlaybackPosition(panner, position) {
        const [x, y, z] = position;
        if (panner.positionX) {
            panner.positionX.value = x;
            panner.positionY.value = y;
            panner.positionZ.value = z;
        } else panner.setPosition?.(x, y, z);
    }

    dispose() {
        this.stopAll({ fade: 0 });
        this.stopPreview(0);
        for (const queue of this.queues.values()) queue.length = 0;
        this.queues.clear();
        this.actionCues.clear();
        this.buses.clear();
        try { this.context?.close(); } catch {}
        this.context = null;
        this.masterGain = null;
        this.compressor = null;
    }
}

export class AudioPlayback {
    constructor(manager, data) {
        Object.assign(this, data);
        this.manager = manager;
        this.state = 'ready';
        this._listeners = new Set();
        this._started = false;
        this._fadeToken = 0;
        this._resolveDone = null;
        this.done = new Promise(resolve => { this._resolveDone = resolve; });
        this._onEnded = () => this.finish('finished');
        this.audio.addEventListener('ended', this._onEnded, { once: true });
        this.audio.addEventListener('error', () => this.finish('error'), { once: true });
    }

    start(delay = 0) {
        const begin = () => {
            if (this.state !== 'ready' && this.state !== 'paused') return;
            this.state = 'playing';
            this._started = true;
            const promise = this.audio.play();
            if (promise?.catch) promise.catch(error => {
                this.manager.onError?.(error);
                this.state = 'blocked';
            });
        };
        if (delay > 0) window.setTimeout(begin, delay * 1000);
        else begin();
        return this;
    }

    pause() {
        if (this.state !== 'playing') return this;
        this.audio.pause();
        this.state = 'paused';
        return this;
    }

    resume() {
        if (this.state !== 'paused' && this.state !== 'blocked') return this;
        return this.start();
    }

    stop({ fade = this.fadeOutDefault } = {}) {
        if (this.state === 'finished' || this.state === 'stopped') return this.done;
        const finish = () => {
            try { this.audio.pause(); } catch {}
            try { this.audio.currentTime = 0; } catch {}
            this.finish('stopped');
        };
        if (fade > 0 && this.gain) this.fadeTo(0, fade).then(finish);
        else finish();
        return this.done;
    }

    seek(seconds) {
        this.audio.currentTime = Math.max(0, Number(seconds) || 0);
        return this;
    }

    setVolume(volume) {
        const value = clamp01(volume);
        this._baseVolume = value;
        const now = this.manager.context?.currentTime || 0;
        this.gain?.gain.setValueAtTime(value, now);
        return this;
    }

    getVolume() {
        return this._baseVolume ?? this.gain?.gain.value ?? 1;
    }

    setLoop(loop) {
        this.audio.loop = !!loop;
        return this;
    }

    setPlaybackRate(rate) {
        this.audio.playbackRate = clampNumber(rate, 0.25, 4);
        return this;
    }

    setPosition(position) {
        if (this.panner) this.manager.setPlaybackPosition(this.panner, position);
        return this;
    }

    async fadeTo(volume, duration = 0.15) {
        if (!this.gain) return this;
        const token = ++this._fadeToken;
        const start = this.gain.gain.value;
        const end = clamp01(volume);
        const seconds = Math.max(0, Number(duration) || 0);
        if (!seconds) {
            this.gain.gain.value = end;
            return this;
        }
        const started = performance.now();
        return new Promise(resolve => {
            const step = () => {
                if (token !== this._fadeToken || this.state === 'finished' || this.state === 'stopped') return resolve(this);
                const t = Math.min(1, (performance.now() - started) / (seconds * 1000));
                const eased = t * t * (3 - 2 * t);
                this.gain.gain.value = start + (end - start) * eased;
                if (t >= 1) return resolve(this);
                requestAnimationFrame(step);
            };
            step();
        });
    }

    onFinished(callback) {
        if (typeof callback !== 'function') return () => {};
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    finish(state) {
        if (this.state === 'finished' || this.state === 'stopped' || this.state === 'error') return;
        this.state = state;
        this._listeners.forEach(callback => {
            try { callback(this); } catch (error) { console.warn('Audio callback error', error); }
        });
        this._resolveDone?.(this);
        this._resolveDone = null;
    }
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

function randomRange(min, max) {
    const a = Number.isFinite(min) ? min : 1;
    const b = Number.isFinite(max) ? max : a;
    return a + Math.random() * (b - a);
}

function normalize(vector) {
    const length = Math.hypot(...vector) || 1;
    return vector.map(value => value / length);
}
