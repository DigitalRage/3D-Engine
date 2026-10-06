/**
 * Conservative spatial index for large worlds.
 *
 * Objects occupy every grid cell touched by their world-space bounding sphere.
 * Queries use a broad sphere around the camera and therefore never reject an
 * object that could reach the camera's far plane. The renderer still performs
 * the exact frustum test afterwards.
 */
export class SpatialGrid {
    constructor({ cellSize = 64, maxCellsPerObject = 256 } = {}) {
        this.cellSize = Math.max(1, Number(cellSize) || 64);
        this.maxCellsPerObject = Math.max(8, Number(maxCellsPerObject) || 256);
        this.cells = new Map();
        this.entries = new Map();
        this.oversized = new Set();
        this.revision = 0;
        this._queryStamp = 0;
    }

    clear() {
        this.cells.clear();
        this.entries.clear();
        this.oversized.clear();
        this.revision++;
    }

    rebuild(items, getBounds) {
        this.cells.clear();
        this.entries.clear();
        this.oversized.clear();
        for (const item of items || []) {
            const bounds = getBounds(item);
            if (bounds) this._insert(item, bounds);
        }
        this.revision++;
    }

    insert(item, bounds) {
        if (!item || !bounds) return;
        this.remove(item, false);
        this._insert(item, bounds);
        this.revision++;
    }

    update(item, bounds) {
        if (!item || !bounds) return;
        const previous = this.entries.get(item);
        const next = this._calculateCellKeys(bounds);
        if (previous && sameStringArray(previous.cells, next.cells) && previous.oversized === next.oversized) {
            previous.centerX = bounds.x;
            previous.centerY = bounds.y;
            previous.centerZ = bounds.z;
            previous.radius = Math.max(0, Number(bounds.r) || 0);
            return;
        }
        this.remove(item, false);
        this._insert(item, bounds, next);
        this.revision++;
    }

    remove(item, bumpRevision = true) {
        const entry = this.entries.get(item);
        if (!entry) return false;
        for (const key of entry.cells) {
            const bucket = this.cells.get(key);
            if (!bucket) continue;
            bucket.delete(entry);
            if (!bucket.size) this.cells.delete(key);
        }
        this.oversized.delete(entry);
        this.entries.delete(item);
        if (bumpRevision) this.revision++;
        return true;
    }

    querySphere(x, y, z, radius, out = []) {
        out.length = 0;
        const r = Math.max(0, Number(radius) || 0);
        const minX = Math.floor((x - r) / this.cellSize);
        const maxX = Math.floor((x + r) / this.cellSize);
        const minY = Math.floor((y - r) / this.cellSize);
        const maxY = Math.floor((y + r) / this.cellSize);
        const minZ = Math.floor((z - r) / this.cellSize);
        const maxZ = Math.floor((z + r) / this.cellSize);
        const stamp = ++this._queryStamp;

        for (let cellX = minX; cellX <= maxX; cellX++) {
            for (let cellY = minY; cellY <= maxY; cellY++) {
                for (let cellZ = minZ; cellZ <= maxZ; cellZ++) {
                    const bucket = this.cells.get(`${cellX}|${cellY}|${cellZ}`);
                    if (!bucket) continue;
                    for (const entry of bucket) {
                        if (entry.lastQuery === stamp) continue;
                        entry.lastQuery = stamp;
                        out.push(entry.item);
                    }
                }
            }
        }

        for (const entry of this.oversized) {
            if (entry.lastQuery === stamp) continue;
            entry.lastQuery = stamp;
            out.push(entry.item);
        }
        return out;
    }

    _insert(item, bounds, precomputed = null) {
        const calc = precomputed || this._calculateCellKeys(bounds);
        const entry = {
            item,
            x: bounds.x,
            y: bounds.y,
            z: bounds.z,
            radius: Math.max(0, Number(bounds.r) || 0),
            cells: calc.cells,
            oversized: calc.oversized,
            lastQuery: 0
        };
        this.entries.set(item, entry);
        if (calc.oversized) {
            this.oversized.add(entry);
            return;
        }
        for (const key of calc.cells) {
            let bucket = this.cells.get(key);
            if (!bucket) this.cells.set(key, bucket = new Set());
            bucket.add(entry);
        }
    }

    _calculateCellKeys(bounds) {
        const r = Math.max(0, Number(bounds.r) || 0);
        const c = this.cellSize;
        const minX = Math.floor((bounds.x - r) / c);
        const maxX = Math.floor((bounds.x + r) / c);
        const minY = Math.floor((bounds.y - r) / c);
        const maxY = Math.floor((bounds.y + r) / c);
        const minZ = Math.floor((bounds.z - r) / c);
        const maxZ = Math.floor((bounds.z + r) / c);
        const span = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
        if (span > this.maxCellsPerObject) return { cells: [], oversized: true };
        const cells = [];
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) cells.push(`${x}|${y}|${z}`);
            }
        }
        return { cells, oversized: false };
    }
}

function sameStringArray(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
