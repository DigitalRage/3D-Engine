export function createBonesPanel({ onAddBone, onRemoveBone, onCreateAnimation, onKeyPose, onDeleteBoneKeys, onSeekAnimation, onToggleAnimation, onRenameAnimation, onSetAnimationDuration, onChange = () => {}, onHistory = () => {} }) {
    const panel = document.createElement('div');
    panel.className = 'editor-panel bone-panel';
    let mesh = null;
    let currentTime = 0;
    let playbackTime = null;
    let playButton = null;
    let timelineInput = null;
    let timelineLabel = null;
    let syncPoseControls = [];

    function addNumber(label, value, onInput, step = '0.05', readValue = null) {
        const group = document.createElement('label');
        group.className = 'field-group';
        const caption = document.createElement('span');
        caption.className = 'field-label';
        caption.textContent = label;
        const input = document.createElement('input');
        input.className = 'editor-input';
        input.type = 'number';
        input.step = step;
        input.value = value;
        input.addEventListener('change', () => { onHistory(); onInput(Number(input.value) || 0); });
        if (readValue) syncPoseControls.push(() => {
            if (document.activeElement !== input) input.value = String(readValue());
        });
        group.append(caption, input);
        panel.appendChild(group);
    }

    function render() {
        panel.innerHTML = '';
        syncPoseControls = [];
        playButton = null;
        timelineInput = null;
        timelineLabel = null;
        const title = document.createElement('div');
        title.className = 'panel-title';
        title.textContent = 'Rig and Animation';
        panel.appendChild(title);
        if (!mesh) {
            const empty = document.createElement('div');
            empty.className = 'inspector-empty';
            empty.textContent = 'Select a mesh to edit its rig.';
            panel.appendChild(empty);
            return;
        }

        const boneList = document.createElement('div');
        boneList.className = 'bone-list';
        mesh.skeleton.bones.forEach((bone, index) => {
            const select = document.createElement('button');
            select.className = 'bone-item' + (mesh.selectedBone === index ? ' selected' : '');
            select.type = 'button';
            select.textContent = `${bone.parent ? '  ' : ''}${bone.name}`;
            select.addEventListener('click', () => {
                mesh.selectedBone = index;
                render();
            });
            boneList.appendChild(select);
        });
        panel.appendChild(boneList);

        const addRoot = document.createElement('button');
        addRoot.className = 'editor-button';
        addRoot.type = 'button';
        addRoot.textContent = 'Add root bone';
        addRoot.addEventListener('click', () => onAddBone(null));
        const addChild = document.createElement('button');
        addChild.className = 'editor-button';
        addChild.type = 'button';
        addChild.textContent = 'Add child bone';
        addChild.disabled = mesh.selectedBone == null;
        addChild.addEventListener('click', () => onAddBone(mesh.selectedBone));
        panel.append(addRoot, addChild);

        renderAnimationEditor();

        const bone = mesh.skeleton.bones[mesh.selectedBone];
        if (!bone) {
            const empty = document.createElement('div');
            empty.className = 'inspector-empty field-group';
            empty.textContent = 'Add or select a bone to edit its pose.';
            panel.appendChild(empty);
            return;
        }

        const name = document.createElement('input');
        name.className = 'editor-input field-group';
        name.value = bone.name;
        name.setAttribute('aria-label', 'Bone name');
        name.addEventListener('change', () => {
            onHistory();
            const previousName = bone.name;
            bone.name = name.value.trim() || bone.name;
            mesh.animationClip?.tracks.forEach(track => {
                if (track.boneName === previousName) track.boneName = bone.name;
            });
            onChange();
            render();
        });
        panel.appendChild(name);
        const parentLabel = document.createElement('div');
        parentLabel.className = 'inspector-empty field-group';
        parentLabel.textContent = `Parent: ${bone.parent?.name || 'Root'}`;
        panel.appendChild(parentLabel);

        ['X', 'Y', 'Z'].forEach((axis, index) => {
            addNumber(`Joint position ${axis}`, bone.position[index], value => {
                bone.position[index] = value;
                if (!mesh.animationClip) bone.bindPosition[index] = value;
                onChange();
            }, '0.05', () => bone.position[index]);
        });

        ['X', 'Y', 'Z'].forEach((axis, index) => {
            const group = document.createElement('div');
            group.className = 'field-group bone-slider-group';
            const labelRow = document.createElement('div');
            labelRow.className = 'bone-slider-label';
            const label = document.createElement('span');
            label.className = 'field-label';
            label.textContent = `Joint rotation ${axis}`;
            const valueLabel = document.createElement('output');
            const degrees = Math.round(bone.rotation[index] * 180 / Math.PI);
            valueLabel.textContent = `${degrees} deg (${Math.round(Math.abs(degrees) / 180 * 100)}%)`;
            labelRow.append(label, valueLabel);
            const slider = document.createElement('input');
            slider.className = 'editor-input';
            slider.type = 'range';
            slider.min = '-180';
            slider.max = '180';
            slider.step = '1';
            slider.value = String(degrees);
            slider.addEventListener('input', () => {
                onHistory();
                const next = Number(slider.value);
                bone.rotation[index] = next * Math.PI / 180;
                if (!mesh.animationClip) bone.bindRotation[index] = bone.rotation[index];
                valueLabel.textContent = `${next} deg (${Math.round(Math.abs(next) / 180 * 100)}%)`;
                onChange();
            });
            syncPoseControls.push(() => {
                if (document.activeElement === slider) return;
                const currentDegrees = Math.round(bone.rotation[index] * 180 / Math.PI);
                slider.value = String(currentDegrees);
                valueLabel.textContent = `${currentDegrees} deg (${Math.round(Math.abs(currentDegrees) / 180 * 100)}%)`;
            });
            group.append(labelRow, slider);
            panel.appendChild(group);
        });

        const lengthGroup = document.createElement('div');
        lengthGroup.className = 'field-group bone-slider-group';
        const lengthLabel = document.createElement('div');
        lengthLabel.className = 'bone-slider-label';
        const lengthName = document.createElement('span');
        lengthName.className = 'field-label';
        lengthName.textContent = 'Bone length';
        const lengthValue = document.createElement('output');
        lengthLabel.append(lengthName, lengthValue);
        const length = document.createElement('input');
        length.className = 'editor-input';
        length.type = 'range';
        length.min = '0.05';
        length.max = '2';
        length.step = '0.01';
        length.value = String(bone.length);
        const updateLength = () => {
            lengthValue.textContent = `${Number(length.value).toFixed(2)} (${Math.round(Number(length.value) / 2 * 100)}%)`;
        };
        updateLength();
        length.addEventListener('input', () => {
            onHistory();
            bone.length = Number(length.value);
            updateLength();
            onChange();
        });
        lengthGroup.append(lengthLabel, length);
        panel.appendChild(lengthGroup);

        const deleteBone = document.createElement('button');
        deleteBone.className = 'editor-button';
        deleteBone.type = 'button';
        deleteBone.textContent = 'Delete bone and children';
        deleteBone.addEventListener('click', () => onRemoveBone(mesh.selectedBone));
        panel.appendChild(deleteBone);

        ['X', 'Y', 'Z'].forEach((axis, index) => {
            addNumber(`Bone scale ${axis}`, bone.scale[index], value => {
                bone.scale[index] = value;
                if (!mesh.animationClip) bone.bindScale[index] = value;
                onChange();
            }, '0.01', () => bone.scale[index]);
        });

        const selectedVertex = mesh.selectedVertex;
        const weightGroup = document.createElement('div');
        weightGroup.className = 'bone-weight-group';
        const weightTitle = document.createElement('div');
        weightTitle.className = 'panel-title';
        weightTitle.textContent = 'Vertex skinning';
        weightGroup.appendChild(weightTitle);
        const weightLabel = document.createElement('div');
        weightLabel.className = 'inspector-empty field-group';
        weightLabel.textContent = selectedVertex
            ? `Vertex ${selectedVertex.vertexIndex + 1} on face ${selectedVertex.faceIndex + 1}`
            : 'Select a vertex in Vertex mode first.';
        weightGroup.appendChild(weightLabel);
        const skin = selectedVertex && mesh.vertexWeights.get(mesh.polygons[selectedVertex.faceIndex]?.[selectedVertex.vertexIndex]);
        const weightSlider = document.createElement('input');
        weightSlider.className = 'editor-input';
        weightSlider.type = 'range';
        weightSlider.min = '0';
        weightSlider.max = '100';
        weightSlider.step = '1';
        weightSlider.value = String(Math.round((skin?.weights.get(bone) || 0) * 100));
        weightSlider.disabled = !selectedVertex;
        const weightValue = document.createElement('output');
        weightValue.textContent = `${weightSlider.value}%`;
        weightSlider.addEventListener('input', () => { weightValue.textContent = `${weightSlider.value}%`; });
        weightGroup.append(weightSlider, weightValue);
        const assign = document.createElement('button');
        assign.className = 'editor-button';
        assign.type = 'button';
        assign.textContent = 'Assign weight to this bone';
        assign.disabled = !selectedVertex;
        assign.addEventListener('click', () => {
            if (!selectedVertex) return;
            onHistory();
            mesh.setVertexBoneWeight(selectedVertex.faceIndex, selectedVertex.vertexIndex, bone, Number(weightSlider.value) / 100);
            onChange();
            render();
        });
        const assignFace = document.createElement('button');
        assignFace.className = 'editor-button';
        assignFace.type = 'button';
        assignFace.textContent = 'Weight selected face';
        assignFace.addEventListener('click', () => {
            onHistory();
            const faceIndex = mesh.selectedFace;
            mesh.polygons[faceIndex]?.forEach((_, vertexIndex) => {
                mesh.setVertexBoneWeight(faceIndex, vertexIndex, bone, Number(weightSlider.value) / 100);
            });
            onChange();
            render();
        });
        const autoWeight = document.createElement('button');
        autoWeight.className = 'editor-button';
        autoWeight.type = 'button';
        autoWeight.textContent = 'Auto-weight near this bone';
        autoWeight.addEventListener('click', () => {
            onHistory();
            mesh.autoWeightBone(bone, Math.max(0.05, bone.length));
            onChange();
            render();
        });
        const clear = document.createElement('button');
        clear.className = 'editor-button';
        clear.type = 'button';
        clear.textContent = 'Clear vertex weights';
        clear.disabled = !selectedVertex || !skin;
        clear.addEventListener('click', () => {
            onHistory();
            if (selectedVertex) mesh.clearVertexBoneWeights(selectedVertex.faceIndex, selectedVertex.vertexIndex);
            onChange();
            render();
        });
        weightGroup.append(assign, assignFace, autoWeight, clear);
        const skinningDisclosure = document.createElement('details');
        skinningDisclosure.className = 'panel-disclosure skinning-disclosure';
        const skinningSummary = document.createElement('summary');
        skinningSummary.textContent = 'Vertex skinning weights';
        skinningDisclosure.append(skinningSummary, weightGroup);
        panel.appendChild(skinningDisclosure);
    }

    function renderAnimationEditor() {
        const section = document.createElement('section');
        section.className = 'animation-editor';
        const heading = document.createElement('div');
        heading.className = 'panel-title';
        heading.textContent = 'Animation Clip';
        section.appendChild(heading);

        const clip = mesh.animationClip;
        if (!clip) {
            const create = document.createElement('button');
            create.className = 'editor-button';
            create.type = 'button';
            create.textContent = 'Create animation';
            create.addEventListener('click', onCreateAnimation);
            section.appendChild(create);
            panel.appendChild(section);
            return;
        }

        const clipFields = document.createElement('div');
        clipFields.className = 'animation-clip-fields';
        const name = document.createElement('input');
        name.className = 'editor-input';
        name.type = 'text';
        name.value = clip.name;
        name.setAttribute('aria-label', 'Animation name');
        name.addEventListener('change', () => onRenameAnimation(name.value));
        const duration = document.createElement('input');
        duration.className = 'editor-input animation-duration';
        duration.type = 'number';
        duration.min = '0.1';
        duration.step = '0.1';
        duration.value = String(clip.duration);
        duration.setAttribute('aria-label', 'Animation duration in seconds');
        duration.addEventListener('change', () => onSetAnimationDuration(Number(duration.value)));
        const durationLabel = document.createElement('label');
        durationLabel.className = 'animation-duration-label';
        durationLabel.append(document.createTextNode('Duration'), duration, document.createTextNode('s'));
        clipFields.append(name, durationLabel);
        section.appendChild(clipFields);

        const playback = document.createElement('div');
        playback.className = 'animation-playback';
        const initialTime = Math.min(playbackTime ?? currentTime, clip.duration);
        timelineInput = document.createElement('input');
        timelineInput.className = 'editor-input animation-timeline';
        timelineInput.type = 'range';
        timelineInput.min = '0';
        timelineInput.max = String(clip.duration);
        timelineInput.step = '0.01';
        timelineInput.value = String(initialTime);
        timelineLabel = document.createElement('output');
        timelineLabel.className = 'animation-time';
        timelineLabel.textContent = `${initialTime.toFixed(2)} s`;
        timelineInput.addEventListener('input', () => {
            currentTime = Number(timelineInput.value);
            playbackTime = currentTime;
            timelineLabel.textContent = `${currentTime.toFixed(2)} s`;
            onSeekAnimation(currentTime);
            if (playButton) playButton.textContent = 'Play';
        });
        playButton = document.createElement('button');
        playButton.className = 'editor-button';
        playButton.type = 'button';
        playButton.textContent = mesh.animationPlayer.playing ? 'Pause' : 'Play';
        playButton.addEventListener('click', () => {
            const playing = onToggleAnimation(Number(timelineInput.value));
            playButton.textContent = playing ? 'Pause' : 'Play';
        });
        playback.append(playButton, timelineInput, timelineLabel);
        section.appendChild(playback);

        const tracks = document.createElement('div');
        tracks.className = 'animation-tracks';
        mesh.skeleton.bones.forEach((bone, index) => {
            const row = document.createElement('div');
            row.className = 'animation-track' + (mesh.selectedBone === index ? ' selected' : '');
            const boneName = document.createElement('span');
            boneName.className = 'animation-track-name';
            boneName.textContent = bone.name;
            const lane = document.createElement('div');
            lane.className = 'animation-key-lane';
            const keyTimes = [...new Set(clip.tracks
                .filter(track => track.boneName === bone.name)
                .flatMap(track => track.times))].sort((timeA, timeB) => timeA - timeB);
            keyTimes.forEach(time => {
                const marker = document.createElement('button');
                marker.className = 'animation-keyframe';
                marker.type = 'button';
                marker.style.left = `${time / clip.duration * 100}%`;
                marker.title = `${bone.name}, ${time.toFixed(2)} seconds`;
                marker.setAttribute('aria-label', `Select ${bone.name} keyframe at ${time.toFixed(2)} seconds`);
                marker.addEventListener('click', () => {
                    mesh.selectedBone = index;
                    currentTime = time;
                    playbackTime = time;
                    onSeekAnimation(time);
                    render();
                });
                lane.appendChild(marker);
            });
            row.append(boneName, lane);
            tracks.appendChild(row);
        });
        if (!mesh.skeleton.bones.length) {
            const empty = document.createElement('div');
            empty.className = 'inspector-empty animation-empty';
            empty.textContent = 'Add bones to create skeletal keyframes.';
            tracks.appendChild(empty);
        }
        section.appendChild(tracks);

        const keyActions = document.createElement('div');
        keyActions.className = 'animation-key-actions';
        const keyPose = document.createElement('button');
        keyPose.className = 'editor-button';
        keyPose.type = 'button';
        keyPose.textContent = 'Key selected bone pose';
        keyPose.disabled = mesh.selectedBone == null;
        keyPose.addEventListener('click', () => onKeyPose(mesh.selectedBone, Number(timelineInput.value)));
        const deleteKeys = document.createElement('button');
        deleteKeys.className = 'editor-button';
        deleteKeys.type = 'button';
        deleteKeys.textContent = 'Delete keys at playhead';
        deleteKeys.disabled = mesh.selectedBone == null;
        deleteKeys.addEventListener('click', () => onDeleteBoneKeys(mesh.selectedBone, Number(timelineInput.value)));
        keyActions.append(keyPose, deleteKeys);
        section.appendChild(keyActions);
        panel.appendChild(section);
    }

    return {
        element: panel,
        setMesh(nextMesh) {
            mesh = nextMesh;
            currentTime = mesh?.animationPlayer.time || 0;
            playbackTime = currentTime;
            if (mesh && mesh.selectedBone == null && mesh.skeleton.bones.length) mesh.selectedBone = 0;
            render();
        },
        refresh: render,
        updatePlayback(time, playing) {
            playbackTime = time;
            syncPoseControls.forEach(sync => sync());
            if (timelineInput && !timelineInput.matches(':active')) {
                timelineInput.value = String(Math.min(time, Number(timelineInput.max)));
                currentTime = Number(timelineInput.value);
                if (timelineLabel) timelineLabel.textContent = `${currentTime.toFixed(2)} s`;
            }
            if (playButton) playButton.textContent = playing ? 'Pause' : 'Play';
        }
    };
}
