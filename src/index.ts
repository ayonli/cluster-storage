import { EventEmitter } from "cluster-events";
import { isManager } from "manager-process";
import set = require("lodash/set");
import get = require("lodash/get");
import * as fs from "fs-extra";
import * as path from "path";
import * as FRON from "fron";

const state = Symbol("state");
const oid = Symbol("objectId");

export interface StorageOptions {
    path?: string;
    gcTimeout?: number;
}

/** Half-memory, half-file database storage. */
export class Storage extends EventEmitter implements StorageOptions {
    readonly name: string;
    readonly path: string;
    readonly dbpath: string;
    readonly gcTimeout: number;
    private data: { [x: string]: [number, any] } = {};
    private gcTimer: NodeJS.Timeout;

    constructor(name: string, options: StorageOptions = {}) {
        super(name);
        this[oid] = this.generateId();
        this[state] = "active";
        this.name = this.id;
        this.path = options.path || process.cwd();
        this.dbpath = path.resolve(this.path, name + ".db");
        this.gcTimeout = options.gcTimeout || 30000;
        this.gcTimer = setInterval(async () => {
            await this.gc(this.data);

            if (await isManager()) {
                await this.flush();
            }
        }, this.gcTimeout);

        this.on("private:set", async (id, path, data) => {
            // When receiving the 'set' event, other processes in the cluster 
            // should set data as well and keep the database always synchronized.
            id !== this[oid] && set(this.data, path, await FRON.parseAsync(data));
        }).on("private:sync", async (id) => {
            // When receiving the 'sync' event, if the current process is the 
            // manager process, flush all stored data to file, when done, notify
            // the cluster that the file db has been updated.
            if (await isManager()) {
                await this.flush();
                this.emit("private:finishSync", id)
            }
        });
    }

    get closed() {
        return this[state] == "closed";
    }

    private generateId() {
        return Math.random().toString(16).slice(2);
    }

    private async gc(node) {
        let now = Date.now();

        for (let x in node) {
            if (Array.isArray(node[x])
                && node[x].length === 2 && typeof node[x][0] === "number"
                && node[x][0] !== 0 && (now - node[x][0] <= 0)) {
                delete node[x];
            } else if (typeof node[x] == "object" && !Array.isArray(node[x])) {
                await this.gc(node[x]);
            }
        }
    }

    private async flush() {
        let data = await FRON.stringifyAsync(this.data);
        await fs.writeFile(this.dbpath, data);
    }

    private async read() {
        let data = await fs.readFile(this.dbpath, "utf8");
        this.data = await FRON.parseAsync(data, this.path);
    }

    /**
    * Sets data to the given path.
     * @param ttl Time-to-live in milliseconds, default is `0`, means persist 
     *  forever.
     * @example
     *  storage.set("hello", "world");
     *  storage.set("inner.scope", "Hello, World!");
     */
    async set<T>(path: string, value: T, ttl: number = 0): Promise<T> {
        let data = ttl ? [Date.now() + ttl, value] : [0, value];
        set(this.data, path, data);
        this.emit("private:set", this[oid], path, await FRON.stringify(data));
        return this.get(path);
    }

    /**
     * Gets data according to the given path.
     * @example
     *  storage.get("hello");
     *  storage.get("inner.scope");
     */
    get<T = any>(path: string): Promise<T> {
        let [time, value] = get(this.data, path);
        return (!time || Date.now() - time > 0) ? value : void 0;
    }

    /** Synchronizes data when the process has just rebooted. */
    async sync() {
        await new Promise((resolve, reject) => {
            let id = this.generateId();
            let timer = setTimeout(() => {
                reject(new Error("sync failed after 5000ms timeout"));
            }, 5000);

            // publish the sync event to all cluster processes.
            this.once("private:finishSync", rid => {
                rid === id && resolve();
                clearInterval(timer);
            }).emit("private:sync", id);
        });
        await this.read();
    }

    /** Closes the storage channel and wipe the data copy. */
    async close() {
        this[state] = "closed";
        this.data = {};
        clearInterval(this.gcTimer);
        this.removeAllListeners("private:set");

        if (await isManager()) {
            await this.flush();
        }
    }
}

export default Storage;