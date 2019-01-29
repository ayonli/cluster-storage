import * as path from "path";
import * as fs from "fs-extra";
import { EventEmitter } from "cluster-events";
import { isManager } from "manager-process";
import set = require("lodash/set");
import get = require("lodash/get");
import has = require("lodash/has");
import pick = require("lodash/pick");
import unset = require("lodash/unset");
import clone = require("lodash/cloneDeep");
import { state, oid, randStr, checkState, isDifferent } from './util';

export interface StoreOptions {
    /**
     * A directory of where to store the file copy of data. default value 
     * is `process.cwd()`.
     */
    path?: string;
    /**
     * The interval time of garbage collection, default value is `120000` (2
     * minutes).
     */
    gcInterval?: number;
}

/** Half-memory-half-file storage system for cluster applications. */
export class Storage extends EventEmitter implements StoreOptions {
    readonly name: string;
    readonly path: string;
    readonly gcInterval: number;
    private data: { [x: string]: any } = {};
    private lives: { [x: string]: number } = {};
    private gcTimer: NodeJS.Timeout;

    constructor(name: string, options: StoreOptions = {}) {
        super(name);
        this[oid] = randStr();
        this[state] = "connected";
        this.name = this.id;
        this.path = options.path || process.cwd();
        this.gcInterval = options.gcInterval || 120000;
        this.gcTimer = setInterval(async () => {
            this.gc();

            if (await isManager()) {
                await this.flush();
            }
        }, this.gcInterval);

        this.on("private:set", async (id, path, data, life) => {
            // When receiving the 'set' event, other processes in the cluster 
            // should set data as well and keep the data always synchronized.
            if (id !== this[oid] && this.connected) {
                set(this.data, path, data);
                life && (this.lives[path] = life);
            }
        }).on("private:delete", async (id, path) => {
            // When receiving the 'delete' event, other processes in the cluster 
            // should delete data as well and keep the data always synchronized.
            if (id !== this[oid] && this.connected) {
                unset(this.data, path);
            }
        }).on("private:sync", async (id) => {
            // When receiving the 'sync' event, if the current process is the 
            // manager process, flush all stored data to file, when done, notify
            // the cluster that the file has been updated.
            if (await isManager()) {
                await this.flush();
                this.emit("private:finishSync", id)
            }
        });
    }

    /** Returns the filename of where the data will be stored in the disk. */
    get filename() {
        return path.resolve(this.path, this.name + ".db");
    }

    /** Whether the storage channel has been connected. */
    get connected() {
        return !this.closed;
    }

    /**
     * Whether the storage channel has been closed, once closed, the data can no
     * longer be manipulated.
     */
    get closed() {
        return this[state] == "closed";
    }

    private gc() {
        let now = Date.now();

        for (let path in this.lives) {
            if (this.lives[path] < now) {
                unset(this.data, path);
                delete this.lives[path];
            }
        }
    }

    private async flush() {
        await fs.writeFile(this.filename, JSON.stringify(pick(this, [
            "lives",
            "data"
        ])), "utf8");
    }

    private async read() {
        let data = await fs.readFile(this.filename, "utf8");
        Object.assign(this, pick(JSON.parse(data), ["lives", "data"]));
    }

    /**
     * Sets data to the given path.
     * @param ttl Time-to-live in milliseconds, default is `0`, means persisting
     *  forever.
     * @example
     *  store.set("hello", "world");
     *  store.set("foo.bar", "Hello, World!");
     */
    set<T>(path: string, data: T, ttl: number = 0): T {
        checkState(this);

        let oldLife = this.lives[path];
        let oldData = this.get(path);

        if (ttl) {
            this.lives[path] = Date.now() + ttl;
        }

        if (this.lives[path] != oldLife || isDifferent(data, oldData)) {
            // Set data only if it has been changed.
            set(this.data, path, JSON.parse(JSON.stringify(data)));
            this.emit("private:set", this[oid], path, data, this.lives[path]);

            return this.get(path);
        } else {
            return oldData;
        }
    }

    /**
     * Gets data according to the given path, if no data is found, `null` will 
     * be returned.
     * @example
     *  store.get("hello");
     *  store.get("foo.bar");
     */
    get<T = any>(path: string): T {
        checkState(this);

        let data = null;

        if (!this.lives[path] || Date.now() < this.lives[path]) {
            data = get(this.data, path, null);
        }

        return clone(data);
    }

    /** Checks if data exists according to the given path. */
    has(path: string): boolean {
        checkState(this);

        if (!this.lives[path] || Date.now() < this.lives[path]) {
            return has(this.data, path);
        }

        return false;
    }

    /** Deletes data according to the given path. */
    delete(path: string): void {
        checkState(this);

        unset(this.data, path);
        this.emit("private:delete", this[oid], path);
        delete this.lives[path];
    }

    /**
     * This method is used to synchronizes data in a new process, it will ask 
     * the manager process to flush existing data to the file copy and then it 
     * will read the data from the file.
     */
    async sync() {
        checkState(this);

        await new Promise((resolve, reject) => {
            let id = randStr();
            let timer = setTimeout(() => {
                reject(new Error("sync data failed after 5000ms timeout."));
            }, 5000);

            // publish the sync event to all cluster processes.
            this.once("private:finishSync", rid => {
                rid === id && resolve();
                clearInterval(timer);
            }).emit("private:sync", id);
        });
        await this.read();
    }

    /** Closes the storage channel and flush out the data copy. */
    async close() {
        checkState(this);

        if (await isManager()) {
            await this.flush();
        }

        this[state] = "closed";
        this.data = {};
        this.lives = {};
        this.removeAllListeners("private:set");
        clearInterval(this.gcTimer);
    }

    /**
     * Clears the data entirely and delete the file copy, the storage channel 
     * will be closed after calling this method.
     */
    async destroy() {
        checkState(this);

        this[state] = "closed";
        this.data = {};
        this.lives = {};
        this.removeAllListeners("private:set");
        clearInterval(this.gcTimer);
        await fs.unlink(this.filename);
    }
}

export default Storage;