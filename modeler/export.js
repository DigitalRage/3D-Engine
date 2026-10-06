import { exportOBJ } from '../engine/obj.js';

export function exportModelToOBJ(model, options = {}) {
    const result = exportOBJ([model], options);
    return result;
}

export function exportModelToJSON(model) {
    return JSON.stringify(model.toJSON(), null, 2);
}
