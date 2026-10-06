import { createDefaultAudioSceneConfig, normalizeAudioSceneConfig } from '../../engine/audioConfig.js';

export function createAudioPanel(scene, audioManager, onHistory = () => {}) {
    const panel = document.createElement('div');
    panel.className = 'editor-panel';

    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = 'OGG Audio';
    panel.appendChild(title);

    const info = document.createElement('div');
    info.className = 'asset-info';
    info.textContent = 'Sound library: assets/sound/index.json';
    panel.appendChild(info);

    const status = document.createElement('output');
    status.className = 'asset-info';
    status.textContent = 'Audio is ready when the browser allows playback.';
    panel.appendChild(status);

    const enableButton = document.createElement('button');
    enableButton.className = 'editor-button';
    enableButton.type = 'button';
    enableButton.textContent = 'Enable Audio';
    enableButton.addEventListener('click', async () => {
        const unlocked = await audioManager?.unlock?.();
        status.textContent = unlocked ? 'Audio enabled.' : 'Audio is still blocked by the browser.';
        refresh();
    });
    panel.appendChild(enableButton);

    const chooseInput = document.createElement('input');
    chooseInput.type = 'file';
    chooseInput.accept = '.ogg,audio/ogg';
    chooseInput.multiple = true;
    chooseInput.hidden = true;
    const chooseButton = document.createElement('button');
    chooseButton.className = 'editor-button';
    chooseButton.type = 'button';
    chooseButton.textContent = 'Choose OGG Files';
    chooseButton.addEventListener('click', () => chooseInput.click());
    chooseInput.addEventListener('change', () => {
        const added = audioManager?.addLocalFiles?.(chooseInput.files) || [];
        status.textContent = added.length
            ? `Loaded ${added.length} local OGG${added.length === 1 ? '' : 's'} for this session.`
            : 'No OGG files were added.';
        chooseInput.value = '';
        refresh();
    });
    panel.append(chooseButton, chooseInput);

    const reloadButton = document.createElement('button');
    reloadButton.className = 'editor-button';
    reloadButton.type = 'button';
    reloadButton.textContent = 'Reload OGG Manifest';
    reloadButton.addEventListener('click', async () => {
        await audioManager?.loadManifest?.();
        status.textContent = `Loaded ${audioManager?.listSounds?.().length || 0} OGG sound${audioManager?.listSounds?.().length === 1 ? '' : 's'}.`;
        refresh();
    });
    panel.appendChild(reloadButton);

    const playerTitle = document.createElement('div');
    playerTitle.className = 'panel-title asset-section-title';
    playerTitle.textContent = 'Player / Preview';
    panel.appendChild(playerTitle);

    const playerRow = document.createElement('div');
    playerRow.className = 'audio-control-row';
    const previewSelect = document.createElement('select');
    previewSelect.className = 'editor-input';
    previewSelect.setAttribute('aria-label', 'OGG sound to preview');
    const previewLoop = document.createElement('input');
    previewLoop.type = 'checkbox';
    previewLoop.setAttribute('aria-label', 'Loop preview');
    const loopLabel = document.createElement('label');
    loopLabel.className = 'check-row';
    loopLabel.append(previewLoop, document.createTextNode('Loop'));
    const playPreview = document.createElement('button');
    playPreview.className = 'editor-button';
    playPreview.type = 'button';
    playPreview.textContent = 'Play';
    playPreview.addEventListener('click', () => {
        if (!previewSelect.value) return;
        audioManager?.unlock?.();
        const playback = audioManager?.preview(previewSelect.value, { loop: previewLoop.checked });
        playback?.onFinished?.(result => {
            if (result.state === 'error') status.textContent = 'OGG playback failed. Check the browser console for the media error.';
        });
        status.textContent = `Playing ${previewSelect.selectedOptions[0]?.textContent || previewSelect.value}.`;
    });
    const stopPreview = document.createElement('button');
    stopPreview.className = 'editor-button';
    stopPreview.type = 'button';
    stopPreview.textContent = 'Stop';
    stopPreview.addEventListener('click', () => {
        audioManager?.stopPreview?.();
        status.textContent = 'Preview stopped.';
    });
    playerRow.append(previewSelect, loopLabel, playPreview, stopPreview);
    panel.appendChild(playerRow);

    const musicTitle = document.createElement('div');
    musicTitle.className = 'panel-title asset-section-title';
    musicTitle.textContent = 'Background Music';
    panel.appendChild(musicTitle);

    const musicSelect = makeSoundSelect();
    panel.appendChild(labelWrap('Music', musicSelect));
    const musicControls = document.createElement('div');
    musicControls.className = 'audio-control-grid';
    const musicAutoplay = checkControl('Autoplay on Play Mode', true);
    const musicLoop = checkControl('Loop', true);
    const musicVolume = rangeControl('Volume', 0, 1, 0.01);
    const musicCrossfade = rangeControl('Crossfade (s)', 0, 10, 0.05);
    const musicRate = rangeControl('Playback rate', 0.25, 2, 0.01);
    musicControls.append(musicAutoplay.element, musicLoop.element, musicVolume.element, musicCrossfade.element, musicRate.element);
    panel.appendChild(musicControls);
    const musicActions = document.createElement('div');
    musicActions.className = 'audio-control-row';
    const musicApply = document.createElement('button');
    musicApply.className = 'editor-button';
    musicApply.type = 'button';
    musicApply.textContent = 'Apply to Scene';
    musicApply.addEventListener('click', () => {
        onHistory();
        const config = normalizeAudioSceneConfig(scene.audio);
        config.music = {
            soundId: musicSelect.value || null,
            autoplay: musicAutoplay.input.checked,
            loop: musicLoop.input.checked,
            volume: Number(musicVolume.input.value),
            crossfade: Number(musicCrossfade.input.value),
            playbackRate: Number(musicRate.input.value)
        };
        scene.audio = config;
        audioManager?.configureScene?.(config);
        status.textContent = config.music.soundId ? 'Background music configured.' : 'Background music cleared.';
    });
    const musicPlayNow = document.createElement('button');
    musicPlayNow.className = 'editor-button';
    musicPlayNow.type = 'button';
    musicPlayNow.textContent = 'Play Now';
    musicPlayNow.addEventListener('click', () => {
        if (!musicSelect.value) return;
        audioManager?.unlock?.();
        audioManager?.playMusic?.(musicSelect.value, {
            loop: musicLoop.input.checked,
            volume: Number(musicVolume.input.value),
            crossfade: Number(musicCrossfade.input.value),
            playbackRate: Number(musicRate.input.value),
            owner: 'preview'
        });
        status.textContent = 'Background music preview playing.';
    });
    const musicStop = document.createElement('button');
    musicStop.className = 'editor-button';
    musicStop.type = 'button';
    musicStop.textContent = 'Stop';
    musicStop.addEventListener('click', () => {
        audioManager?.stopMusic?.({ fade: Number(musicCrossfade.input.value) });
        status.textContent = 'Background music stopped.';
    });
    musicActions.append(musicApply, musicPlayNow, musicStop);
    panel.appendChild(musicActions);

    const busTitle = document.createElement('div');
    busTitle.className = 'panel-title asset-section-title';
    busTitle.textContent = 'Mixer';
    panel.appendChild(busTitle);
    const master = rangeControl('Master', 0, 1, 0.01);
    const masterMute = checkControl('Mute master', false);
    panel.appendChild(master.element);
    panel.appendChild(masterMute.element);
    const busGrid = document.createElement('div');
    busGrid.className = 'audio-control-grid';
    const busControls = new Map();
    for (const bus of ['music', 'sfx', 'ui', 'voice']) {
        const volume = rangeControl(bus.toUpperCase(), 0, 1, 0.01);
        const muted = checkControl(`Mute ${bus}`, false);
        busControls.set(bus, { volume, muted });
        busGrid.append(volume.element, muted.element);
    }
    panel.appendChild(busGrid);
    const applyMixer = document.createElement('button');
    applyMixer.className = 'editor-button';
    applyMixer.type = 'button';
    applyMixer.textContent = 'Apply Mixer to Scene';
    applyMixer.addEventListener('click', () => {
        onHistory();
        const config = normalizeAudioSceneConfig(scene.audio);
        config.masterVolume = Number(master.input.value);
        config.masterMuted = masterMute.input.checked;
        for (const [bus, controls] of busControls) {
            config.buses[bus].volume = Number(controls.volume.input.value);
            config.buses[bus].muted = controls.muted.input.checked;
        }
        scene.audio = config;
        audioManager?.configureScene?.(config);
        status.textContent = 'Mixer settings saved to the scene.';
    });
    panel.appendChild(applyMixer);

    const actionsTitle = document.createElement('div');
    actionsTitle.className = 'panel-title asset-section-title';
    actionsTitle.textContent = 'Action Cues';
    panel.appendChild(actionsTitle);
    const actionsHelp = document.createElement('div');
    actionsHelp.className = 'asset-info';
    actionsHelp.textContent = 'Trigger from scripts with rt.triggerAudioAction("player.jump").';
    panel.appendChild(actionsHelp);
    const actionList = document.createElement('div');
    actionList.className = 'audio-action-list';
    panel.appendChild(actionList);
    const addAction = document.createElement('button');
    addAction.className = 'editor-button';
    addAction.type = 'button';
    addAction.textContent = '+ Action Cue';
    addAction.addEventListener('click', () => {
        onHistory();
        const config = normalizeAudioSceneConfig(scene.audio);
        const soundId = audioManager?.listSounds?.()[0]?.id || '';
        config.actions.push({ id: `cue-${Date.now()}`, action: 'player.action', soundId, bus: 'sfx', mode: 'overlap', volume: 1, loop: false, cooldown: 0, maxVoices: 8, playbackRateMin: 1, playbackRateMax: 1, spatial: false, position: null });
        scene.audio = config;
        renderActions();
    });
    panel.appendChild(addAction);

    function makeSoundSelect() {
        const select = document.createElement('select');
        select.className = 'editor-input';
        select.setAttribute('aria-label', 'OGG sound');
        return select;
    }

    function fillSoundSelect(select, selected) {
        select.innerHTML = '';
        const sounds = audioManager?.listSounds?.() || [];
        if (!sounds.length) {
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = 'No OGGs in manifest';
            select.appendChild(empty);
            return;
        }
        sounds.forEach(sound => {
            const option = document.createElement('option');
            option.value = sound.id;
            option.textContent = sound.name;
            option.title = sound.path;
            option.selected = sound.id === selected;
            select.appendChild(option);
        });
    }

    function renderActions() {
        actionList.innerHTML = '';
        const config = normalizeAudioSceneConfig(scene.audio);
        scene.audio = config;
        config.actions.forEach((cue, index) => {
            const row = document.createElement('div');
            row.className = 'audio-action-row';
            const action = document.createElement('input');
            action.className = 'editor-input';
            action.placeholder = 'Action name';
            action.value = cue.action;
            action.title = 'Script action name';
            const sound = makeSoundSelect();
            fillSoundSelect(sound, cue.soundId);
            const mode = document.createElement('select');
            mode.className = 'editor-input';
            ['overlap', 'queue', 'replace'].forEach(value => { const o = document.createElement('option'); o.value = value; o.textContent = value; mode.appendChild(o); });
            mode.value = cue.mode;
            const bus = document.createElement('select');
            bus.className = 'editor-input';
            ['sfx', 'ui', 'voice', 'music'].forEach(value => { const o = document.createElement('option'); o.value = value; o.textContent = value; bus.appendChild(o); });
            bus.value = cue.bus;
            const volume = rangeControl('Vol', 0, 1, 0.01, cue.volume);
            const cooldown = numberControl('Cooldown', 0, 60, 0.05, cue.cooldown);
            const voices = numberControl('Voices', 1, 64, 1, cue.maxVoices);
            const spatial = checkControl('3D', cue.spatial);
            const remove = document.createElement('button');
            remove.className = 'editor-button';
            remove.type = 'button';
            remove.textContent = 'Remove';

            const commit = () => {
                const next = normalizeAudioSceneConfig(scene.audio);
                next.actions[index] = {
                    ...next.actions[index],
                    action: action.value.trim() || 'player.action',
                    soundId: sound.value,
                    mode: mode.value,
                    bus: bus.value,
                    volume: Number(volume.input.value),
                    cooldown: Number(cooldown.input.value),
                    maxVoices: Number(voices.input.value),
                    spatial: spatial.input.checked
                };
                scene.audio = next;
                audioManager?.configureScene?.(next);
                status.textContent = `Saved action cue: ${next.actions[index].action}`;
            };
            [action, sound, mode, bus].forEach(input => input.addEventListener('change', () => { onHistory(); commit(); }));
            volume.input.addEventListener('input', () => { onHistory(); commit(); });
            cooldown.input.addEventListener('change', () => { onHistory(); commit(); });
            voices.input.addEventListener('change', () => { onHistory(); commit(); });
            spatial.input.addEventListener('change', () => { onHistory(); commit(); });
            remove.addEventListener('click', () => {
                onHistory();
                const next = normalizeAudioSceneConfig(scene.audio);
                next.actions.splice(index, 1);
                scene.audio = next;
                audioManager?.configureScene?.(next);
                renderActions();
            });
            row.append(action, sound, mode, bus, volume.element, cooldown.element, voices.element, spatial.element, remove);
            actionList.appendChild(row);
        });
    }

    function refresh() {
        const config = normalizeAudioSceneConfig(scene.audio);
        scene.audio = config;
        fillSoundSelect(previewSelect, previewSelect.value);
        fillSoundSelect(musicSelect, config.music.soundId);
        musicAutoplay.input.checked = config.music.autoplay;
        musicLoop.input.checked = config.music.loop;
        musicVolume.input.value = config.music.volume;
        musicCrossfade.input.value = config.music.crossfade;
        musicRate.input.value = config.music.playbackRate;
        master.input.value = config.masterVolume;
        masterMute.input.checked = config.masterMuted;
        for (const [bus, controls] of busControls) {
            controls.volume.input.value = config.buses[bus].volume;
            controls.muted.input.checked = config.buses[bus].muted;
        }
        enableButton.textContent = audioManager?.isUnlocked?.() ? 'Audio Enabled' : 'Enable Audio';
        enableButton.disabled = !!audioManager?.isUnlocked?.();
        playPreview.disabled = !previewSelect.value;
        musicPlayNow.disabled = !musicSelect.value;
        renderActions();
    }

    refresh();
    return { element: panel, refresh };
}

function labelWrap(label, element) {
    const group = document.createElement('div');
    group.className = 'field-group';
    const title = document.createElement('label');
    title.className = 'field-label';
    title.textContent = label;
    group.append(title, element);
    return group;
}

function checkControl(label, checked) {
    const wrapper = document.createElement('label');
    wrapper.className = 'check-row field-group';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    wrapper.append(input, document.createTextNode(label));
    return { element: wrapper, input };
}

function rangeControl(label, min, max, step, value = min) {
    const wrapper = document.createElement('div');
    wrapper.className = 'field-group';
    const title = document.createElement('label');
    title.className = 'field-label';
    const valueText = document.createElement('output');
    valueText.className = 'range-value';
    title.append(document.createTextNode(label), valueText);
    const input = document.createElement('input');
    input.className = 'editor-input';
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => { valueText.textContent = Number(input.value).toFixed(2); });
    input.dispatchEvent(new Event('input'));
    wrapper.append(title, input);
    return { element: wrapper, input };
}

function numberControl(label, min, max, step, value) {
    const wrapper = document.createElement('div');
    wrapper.className = 'field-group';
    const title = document.createElement('label');
    title.className = 'field-label';
    title.textContent = label;
    const input = document.createElement('input');
    input.className = 'editor-input';
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    wrapper.append(title, input);
    return { element: wrapper, input };
}
