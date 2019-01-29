import * as path from "path";
import * as fs from "fs-extra";
import { EventEmitter } from "cluster-events";
import { isManager } from "manager-process";
import set = require("lodash/set");
import get = require("lodash/get");
import pick = require("lodash/pick");
import unset = require("lodash/unset");
import clone = require("lodash/cloneDeep");

const state = Symbol("state");
const oid = Symbol("objectId");

export interface CacheOptions {
    /**
     * The directory path of where to store data copy. default value is 
     * `process.cwd()`.
     */
    path?: string;
    /**
     * The interval time of garbage collection, default value is `120000` (2
     * minutes).
     */
    gcInterval?: number;
}

/** Half-memory-half-file cache system. */
export class Cache extends EventEmitter implements CacheOptions {
    readonly name: string;
    readonly path: string;
    readonly gcInterval: number;
    private data: { [x: string]: any } = {};
    private lives: { [x: string]: number } = {};
    private gcTimer: NodeJS.Timeout;

    constructor(name: string, options: CacheOptions = {}) {
        super(name);
        this[oid] = this.generateId();
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
        return path.resolve(this.path, this.name + ".cache");
    }

    /** Whether the cache channel has been connected. */
    get connected() {
        return !this.closed;
    }

    /**
     * Whether the cache channel has been closed, once closed, the cache data 
     * can no longer be manipulated.
     */
    get closed() {
        return this[state] == "closed";
    }

    private checkState() {
        if (this[state] == "closed") {
            throw new ReferenceError(
                "cannot read and write data when the cache is closed."
            );
        }
    }

    private generateId() {
        return Math.random().toString(16).slice(2);
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
     *  cache.set("hello", "world");
     *  cache.set("foo.bar", "Hello, World!");
     */
    set<T>(path: string, data: T, ttl: number = 0): Promise<T> {
        this.checkState();
        set(this.data, path, JSON.parse(JSON.stringify(data)));

        if (ttl) {
            this.lives[path] = Date.now() + ttl;
        }

        this.emit("private:set", this[oid], path, data, this.lives[path]);

        return this.get(path);
    }

    /**
     * Gets data according to the given path.
     * @example
     *  cache.get("hello");
     *  cache.get("foo.bar");
     */
    get<T = any>(path: string): Promise<T> {
        let data = null;
        this.checkState();

        if (!this.lives[path] || Date.now() < this.lives[path]) {
            data = get(this.data, path, null);
        }

        return Promise.resolve(clone(data));
    }

    /** Deletes data according to the given path. */
    delete(path: string): Promise<void> {
        this.checkState();
        unset(this.data, path);
        delete this.lives[path];
        return Promise.resolve(void 0);
    }

    /** Synchronizes data when the process has just rebooted. */
    async sync() {
        this.checkState();
        await new Promise((resolve, reject) => {
            let id = this.generateId();
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

    /** Closes the cache channel and flush out the data copy. */
    async close() {
        this.checkState();

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
     * Clears the cache entirely and delete the file copy, the cache will be 
     * closed after calling this method.
     */
    async destroy() {
        this.checkState();
        this[state] = "closed";
        this.data = {};
        this.lives = {};
        this.removeAllListeners("private:set");
        clearInterval(this.gcTimer);
        await fs.unlink(this.filename);
    }
}

export default Cache;