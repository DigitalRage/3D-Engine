export class AnimationClip {
    constructor(name = 'Animation', duration = 1) {
        this.name = name;
        this.duration = duration;
        this.tracks = [];
    }

    addTrack(property, times, values) {
        this.tracks.push({ property, times, values });
    }

    apply(target, time) {
        const sampleTime = ((time % this.duration) + this.duration) % this.duration;
        this.tracks.forEach(track => {
            if (!track.times.length) return;
            let next = track.times.findIndex(value => value >= sampleTime);
            if (next < 0) next = track.times.length - 1;
            const previous = Math.max(0, next - 1);
            const start = track.times[previous];
            const end = track.times[next];
            const amount = end === start ? 0 : (sampleTime - start) / (end - start);
            const from = track.values[previous];
            const to = track.values[next];
            target[track.property] = from.map((value, index) => value + (to[index] - value) * amount);
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

    play(clip) {
        this.clip = clip || this.clip;
        this.time = 0;
        this.playing = !!this.clip;
    }

    stop() {
        this.playing = false;
    }

    update(deltaTime) {
        if (!this.playing || !this.clip) return;
        this.time += deltaTime;
        this.clip.apply(this.target, this.time);
    }
}
