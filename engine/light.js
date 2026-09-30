export class DirectionalLight {
    constructor({ name = 'Key Light', direction = [-0.4, -0.8, -0.5], color = [1, 0.96, 0.88], intensity = 1, threshold = 0.42, shadeColor = [0.52, 0.58, 0.76] } = {}) {
        this.name = name;
        this.direction = [...direction];
        this.color = [...color];
        this.intensity = intensity;
        this.threshold = threshold;
        this.shadeColor = [...shadeColor];
    }
}
