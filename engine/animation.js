export class AnimationClip {
    constructor(name = 'Animation', duration = 1) {
        this.name = name;
        this.duration = duration;
        this.tracks = [];
    }

    addTrack(property, times, values) {
        this.tracks.push({ property, times, values });
    }

    addBoneKeyframe(boneName, property, time, value) {
        time = Math.max(0, Math.min(this.duration, time));
        let track = this.tracks.find(candidate => candidate.boneName === boneName && candidate.property === property);
        if (!track) {
            track = { boneName, property, times: [], values: [] };
            this.tracks.push(track);
        }
        const existing = track.times.findIndex(keyTime => Math.abs(keyTime - time) < 1e-6);
        if (existing >= 0) track.values[existing] = [...value];
        else {
            const insertAt = track.times.findIndex(keyTime => keyTime > time);
            const index = insertAt < 0 ? track.times.length : insertAt;
            track.times.splice(index, 0, time);
            track.values.splice(index, 0, [...value]);
        }
    }

    removeBoneKeyframes(boneName, time) {
        let removed = false;
        this.tracks = this.tracks.filter(track => {
            if (track.boneName !== boneName) return true;
            const keyIndex = track.times.findIndex(keyTime => Math.abs(keyTime - time) < 1e-3);
            if (keyIndex < 0) return true;
            track.times.splice(keyIndex, 1);
            track.values.splice(keyIndex, 1);
            removed = true;
            return track.times.length > 0;
        });
        return removed;
    }

    setDuration(duration) {
        this.duration = Math.max(0.1, Number(duration) || 0.1);
        this.tracks.forEach(track => {
            const keys = new Map();
            track.times.forEach((time, index) => {
                keys.set(Math.min(time, this.duration), track.values[index]);
            });
            const sortedKeys = [...keys.entries()].sort(([timeA], [timeB]) => timeA - timeB);
            track.times = sortedKeys.map(([time]) => time);
            track.values = sortedKeys.map(([, value]) => value);
        });
    }

    apply(target, time) {
        const sampleTime = ((time % this.duration) + this.duration) % this.duration;
        this.tracks.forEach(track => {
            if (!track.times.length) return;
            const trackTarget = track.boneName ? target.skeleton?.find(track.boneName) : target;
            if (!trackTarget) return;
            let next = track.times.findIndex(value => value > sampleTime);
            let previous;
            let start;
            let end;
            let time = sampleTime;
            if (next < 0) {
                previous = track.times.length - 1;
                next = 0;
                start = track.times[previous];
                end = track.times[0] + this.duration;
            } else if (next === 0) {
                previous = track.times.length - 1;
                start = track.times[previous] - this.duration;
                end = track.times[0];
            } else {
                previous = next - 1;
                start = track.times[previous];
                end = track.times[next];
            }
            const amount = end === start ? 0 : (time - start) / (end - start);
            const from = track.values[previous];
            const to = track.values[next];
            trackTarget[track.property] = from.map((value, index) => value + (to[index] - value) * amount);
        });
    }
}

export class AnimationPlayer {
    constructor(target) {
        this.target = target;
        this.clip = null;
        this.time = 0;
        this.playing = false;
    }

    play(clip, time = 0) {
        this.clip = clip || this.clip;
        this.time = Math.max(0, Math.min(this.clip?.duration || 0, time));
        this.playing = !!this.clip;
        if (this.playing) this.clip.apply(this.target, this.time);
    }

    stop() {
        this.playing = false;
    }

    seek(time) {
        if (!this.clip) return;
        this.time = Math.max(0, Math.min(this.clip.duration, Number(time) || 0));
        this.clip.apply(this.target, this.time);
    }

    update(deltaTime) {
        if (!this.playing || !this.clip) return;
        this.time = (this.time + deltaTime) % this.clip.duration;
        this.clip.apply(this.target, this.time);
    }
}
