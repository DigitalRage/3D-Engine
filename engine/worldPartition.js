/**
 * Runtime world-partition streamer for large/open worlds.
 *
 * Cells are addressed in X/Z world space. Loading is demand-driven, bounded by
 * maxConcurrentLoads, and uses hysteresis so the engine does not thrash when a
 * player/camera hovers around a cell boundary. Load/unload callbacks are expected
 * to add/remove scene content without blocking the render loop.
 */
export class WorldPartition {
    constructor({
        cellSize = 256,
        loadRadius = 2,
        unloadRadius = Math.max(3, loadRadius + 1),
        maxConcurrentLoads = 2,
        maxConcurrentUnloads = 1,
        preloadForwardCells = 0
    } = {}) {
        this.cellSize = Math.max(1, Number(cellSize) || 256);
        this.loadRadius = Math.max(0, Math.floor(Number(loadRadius) || 0));
        this.unloadRadius = Math.max(this.loadRadius, Math.floor(Number(unloadRadius) || this.loadRadius));
        this.maxConcurrentLoads = Math.max(1, Math.floor(Number(maxConcurrentLoads) || 1));
        this.maxConcurrentUnloads = Math.max(1, Math.floor(Number(maxConcurrentUnloads) || 1));
        this.preloadForwardCells = Math.max(0, Math.floor(Number(preloadForwardCells) || 0));
        this.cells = new Map();
        this.cellsByCoord = new Map();
        this.loaded = new Set();
        this.loading = new Map();
        this.unloading = new Map();
        this.loadQueue = [];
        this.unloadQueue = [];
        this.centerCell = null;
        this.centerX = 0;
        this.centerZ = 0;
        this.lastPosition = [0, 0, 0];
        this.revision = 0;
        this.stats = {
            loaded: 0,
            loading: 0,
            unloading: 0,
            queuedLoads: 0,
            queuedUnloads: 0,
            loadErrors: 0
        };
    }

    registerCell(id, options = {}) {
        const key = String(id);
        if (!key) throw new TypeError('World partition cell ID is required');
        if (this.cells.has(key)) throw new Error(`World partition cell already exists: ${key}`);
        const x = Number(options.x);
        const z = Number(options.z);
        if (!Number.isFinite(x) || !Number.isFinite(z)) throw new TypeError(`World partition cell ${key} requires numeric x/z coordinates`);
        const cell = {
            id: key,
            x: Math.trunc(x),
            z: Math.trunc(z),
            data: options.data ?? null,
            load: typeof options.load === 'function' ? options.load : async () => {},
            unload: typeof options.unload === 'function' ? options.unload : async () => {},
            state: 'unloaded',
            error: null,
            lastDistanceSq: Infinity
        };
        const coordKey = `${cell.x}|${cell.z}`;
        if (this.cellsByCoord.has(coordKey)) throw new Error(`World partition cell coordinate is already registered: ${coordKey}`);
        this.cells.set(key, cell);
        this.cellsByCoord.set(coordKey, key);
        this.revision++;
        return cell;
    }

    unregisterCell(id) {
        const cell = this.cells.get(String(id));
        if (!cell) return false;
        if (this.loading.has(cell.id) || this.unloading.has(cell.id)) return false;
        if (this.loaded.has(cell.id)) return false;
        this.cells.delete(cell.id);
        this.cellsByCoord.delete(`${cell.x}|${cell.z}`);
        this._removeQueued(this.loadQueue, cell.id);
        this._removeQueued(this.unloadQueue, cell.id);
        this.revision++;
        return true;
    }

    clear({ unload = true } = {}) {
        const tasks = [];
        if (unload) {
            for (const id of this.loaded) {
                const cell = this.cells.get(id);
                if (cell) tasks.push(this._beginUnload(cell));
            }
        }
        this.cells.clear();
        this.cellsByCoord.clear();
        this.loaded.clear();
        this.loading.clear();
        this.unloading.clear();
        this.loadQueue.length = 0;
        this.unloadQueue.length = 0;
        this.centerCell = null;
        this.revision++;
        return Promise.allSettled(tasks);
    }

    update(position, velocity = null) {
        const p = position || [0, 0, 0];
        const x = Number(p[0]) || 0;
        const z = Number(p[2]) || 0;
        this.lastPosition[0] = x;
        this.lastPosition[1] = Number(p[1]) || 0;
        this.lastPosition[2] = z;

        const cellX = Math.floor(x / this.cellSize);
        const cellZ = Math.floor(z / this.cellSize);
        const nextCenter = `${cellX}|${cellZ}`;
        const changed = nextCenter !== this.centerCell;
        this.centerCell = nextCenter;
        this.centerX = cellX;
        this.centerZ = cellZ;

        // Re-evaluate only when crossing a partition boundary or when there is
        // pending work. Camera rotation inside one cell does not touch streaming.
        if (changed || this.loadQueue.length || this.unloadQueue.length) {
            const desired = this._computeDesired(cellX, cellZ, velocity);
            this._queueLoads(desired);
            this._queueUnloads(desired, cellX, cellZ);
        }
        this._pumpLoads();
        this._pumpUnloads();
        this._refreshStats();
        return this.getStats();
    }

    async loadCell(id) {
        const cell = this.cells.get(String(id));
        if (!cell) throw new Error(`Unknown world partition cell: ${id}`);
        if (this.loaded.has(cell.id)) return false;
        if (this.loading.has(cell.id)) return this.loading.get(cell.id);
        return this._beginLoad(cell);
    }

    async unloadCell(id) {
        const cell = this.cells.get(String(id));
        if (!cell) throw new Error(`Unknown world partition cell: ${id}`);
        if (!this.loaded.has(cell.id)) return false;
        if (this.unloading.has(cell.id)) return this.unloading.get(cell.id);
        return this._beginUnload(cell);
    }

    getStats() {
        return { ...this.stats };
    }

    getCell(id) {
        return this.cells.get(String(id)) || null;
    }

    _computeDesired(centerX, centerZ, velocity) {
        const desired = new Set();
        const forward = velocity && Math.hypot(Number(velocity[0]) || 0, Number(velocity[2]) || 0) > 1e-5
            ? normalizeXZ(velocity[0], velocity[2])
            : null;
        for (let dz = -this.unloadRadius; dz <= this.unloadRadius; dz++) {
            for (let dx = -this.unloadRadius; dx <= this.unloadRadius; dx++) {
                const distanceSq = dx * dx + dz * dz;
                if (distanceSq > this.unloadRadius * this.unloadRadius) continue;
                const cell = this.cellsByCoordinate(centerX + dx, centerZ + dz);
                if (!cell) continue;
                cell.lastDistanceSq = distanceSq;
                if (distanceSq <= this.loadRadius * this.loadRadius) desired.add(cell.id);
                else if (this.preloadForwardCells > 0 && forward) {
                    const forwardDistance = dx * forward.x + dz * forward.z;
                    const lateral = Math.abs(dx * forward.z - dz * forward.x);
                    if (forwardDistance > 0 && forwardDistance <= this.loadRadius + this.preloadForwardCells && lateral <= this.loadRadius) {
                        desired.add(cell.id);
                    }
                }
            }
        }
        return desired;
    }

    cellsByCoordinate(x, z) {
        const id = this.cellsByCoord.get(`${x}|${z}`);
        return id ? (this.cells.get(id) || null) : null;
    }

    _queueLoads(desired) {
        // A fast-moving player may cross several cells before queued I/O starts.
        // Drop obsolete load requests instead of loading an entire trail behind them.
        for (let i = this.loadQueue.length - 1; i >= 0; i--) {
            const id = this.loadQueue[i];
            if (!desired.has(id) || !this.cells.has(id)) this.loadQueue.splice(i, 1);
        }
        for (const id of desired) {
            if (this.loaded.has(id) || this.loading.has(id)) continue;
            if (!this.loadQueue.includes(id)) this.loadQueue.push(id);
        }
        this.loadQueue.sort((a, b) => this._distanceForCell(a) - this._distanceForCell(b));
    }

    _queueUnloads(desired, centerX, centerZ) {
        for (const id of this.loaded) {
            const cell = this.cells.get(id);
            if (!cell || desired.has(cell.id) || this.unloading.has(cell.id)) continue;
            const dx = cell.x - centerX;
            const dz = cell.z - centerZ;
            if (dx * dx + dz * dz <= this.unloadRadius * this.unloadRadius) continue;
            if (!this.unloadQueue.includes(cell.id)) this.unloadQueue.push(cell.id);
        }
        this.unloadQueue.sort((a, b) => this._distanceForCell(b) - this._distanceForCell(a));
    }

    _distanceForCell(id) {
        const cell = this.cells.get(id);
        if (!cell || !this.centerCell) return Infinity;
        const dx = cell.x - this.centerX;
        const dz = cell.z - this.centerZ;
        return dx * dx + dz * dz;
    }

    _pumpLoads() {
        while (this.loading.size < this.maxConcurrentLoads && this.loadQueue.length) {
            const id = this.loadQueue.shift();
            const cell = this.cells.get(id);
            if (!cell || this.loaded.has(id) || this.loading.has(id)) continue;
            this._beginLoad(cell);
        }
    }

    _pumpUnloads() {
        while (this.unloading.size < this.maxConcurrentUnloads && this.unloadQueue.length) {
            const id = this.unloadQueue.shift();
            const cell = this.cells.get(id);
            if (!cell || !this.loaded.has(id) || this.unloading.has(id)) continue;
            this._beginUnload(cell);
        }
    }

    _beginLoad(cell) {
        cell.state = 'loading';
        cell.error = null;
        const task = Promise.resolve().then(() => cell.load(cell.data, cell)).then(() => {
            this.loading.delete(cell.id);
            this.loaded.add(cell.id);
            cell.state = 'loaded';
            this.revision++;
            this._pumpLoads();
            this._refreshStats();
            return true;
        }).catch(error => {
            this.loading.delete(cell.id);
            cell.state = 'error';
            cell.error = error;
            this.stats.loadErrors++;
            this.revision++;
            this._pumpLoads();
            this._refreshStats();
            return false;
        });
        this.loading.set(cell.id, task);
        this._refreshStats();
        return task;
    }

    _beginUnload(cell) {
        cell.state = 'unloading';
        const task = Promise.resolve().then(() => cell.unload(cell.data, cell)).then(() => {
            this.unloading.delete(cell.id);
            this.loaded.delete(cell.id);
            cell.state = 'unloaded';
            this.revision++;
            this._pumpUnloads();
            this._refreshStats();
            return true;
        }).catch(error => {
            this.unloading.delete(cell.id);
            cell.state = 'loaded';
            cell.error = error;
            this.revision++;
            this._pumpUnloads();
            this._refreshStats();
            return false;
        });
        this.unloading.set(cell.id, task);
        this._refreshStats();
        return task;
    }

    _removeQueued(queue, id) {
        for (let i = queue.length - 1; i >= 0; i--) if (queue[i] === id) queue.splice(i, 1);
    }

    _refreshStats() {
        this.stats.loaded = this.loaded.size;
        this.stats.loading = this.loading.size;
        this.stats.unloading = this.unloading.size;
        this.stats.queuedLoads = this.loadQueue.length;
        this.stats.queuedUnloads = this.unloadQueue.length;
    }
}

function normalizeXZ(x, z) {
    const length = Math.hypot(Number(x) || 0, Number(z) || 0) || 1;
    return { x: (Number(x) || 0) / length, z: (Number(z) || 0) / length };
}
