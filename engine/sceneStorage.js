/**
 * Persistent scene document storage.
 *
 * IndexedDB is used for scene documents because large imported maps can easily
 * exceed the ~5 MiB localStorage quota. localStorage is retained only as a
 * legacy migration source for older engine versions.
 */
export class IndexedDbSceneStore {
    constructor({
        dbName = 'lightweight-3d-scenes',
        storeName = 'documents',
        indexedDB = globalThis.indexedDB
    } = {}) {
        this.dbName = dbName;
        this.storeName = storeName;
        this.indexedDB = indexedDB || null;
        this.dbPromise = null;
    }

    get supported() {
        return !!this.indexedDB && typeof this.indexedDB.open === 'function';
    }

    async open() {
        if (!this.supported) throw new Error('IndexedDB is unavailable');
        if (this.dbPromise) return this.dbPromise;
        this.dbPromise = new Promise((resolve, reject) => {
            let request;
            try {
                request = this.indexedDB.open(this.dbName, 1);
            } catch (error) {
                reject(error);
                return;
            }
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName);
            };
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => db.close();
                resolve(db);
            };
            request.onerror = () => reject(request.error || new Error('Could not open IndexedDB'));
            request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another tab'));
        });
        return this.dbPromise;
    }

    async get(key) {
        const db = await this.open();
        return requestAsPromise(db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(key));
    }

    async set(key, value) {
        const db = await this.open();
        try {
            return await requestAsPromise(db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).put(value, key));
        } catch (error) {
            // IndexedDB uses structuredClone internally and rejects Proxy objects.
            // Scene documents are JSON-compatible, so sanitize only after a clone
            // failure to avoid paying an extra deep-copy cost on every normal save.
            const safeValue = cloneJsonFallback(value);
            return requestAsPromise(db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).put(safeValue, key));
        }
    }

    async delete(key) {
        const db = await this.open();
        return requestAsPromise(db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).delete(key));
    }
}

function requestAsPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
}

function cloneJsonFallback(value) {
    return JSON.parse(JSON.stringify(value));
}
