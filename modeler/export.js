export function exportModelToJSON(model) {
    return JSON.stringify(model.toJSON(), null, 2);
}
