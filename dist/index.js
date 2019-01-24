"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const cluster_events_1 = require("cluster-events");
const manager_process_1 = require("manager-process");
const set = require("lodash/set");
const get = require("lodash/get");
const fs = require("fs-extra");
const path = require("path");
const FRON = require("fron");
const state = Symbol("state");
const oid = Symbol("objectId");
class Storage extends cluster_events_1.EventEmitter {
    constructor(name, options = {}) {
        super(name);
        this.data = {};
        this[oid] = this.generateId();
        this[state] = "active";
        this.name = this.id;
        this.path = options.path || process.cwd();
        this.dbpath = path.resolve(this.path, name + ".db");
        this.gcTimeout = options.gcTimeout || 30000;
        this.gcTimer = setInterval(() => tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.gc(this.data);
            if (yield manager_process_1.isManager()) {
                yield this.flush();
            }
        }), this.gcTimeout);
        this.on("private:set", (id, path, data) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            id !== this[oid] && set(this.data, path, yield FRON.parseAsync(data));
        })).on("private:sync", (id) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (yield manager_process_1.isManager()) {
                yield this.flush();
                this.emit("private:finishSync", id);
            }
        }));
    }
    get closed() {
        return this[state] == "closed";
    }
    generateId() {
        return Math.random().toString(16).slice(2);
    }
    gc(node) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let now = Date.now();
            for (let x in node) {
                if (Array.isArray(node[x])
                    && node[x].length === 2 && typeof node[x][0] === "number"
                    && node[x][0] !== 0 && (now - node[x][0] <= 0)) {
                    delete node[x];
                }
                else if (typeof node[x] == "object" && !Array.isArray(node[x])) {
                    yield this.gc(node[x]);
                }
            }
        });
    }
    flush() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let data = yield FRON.stringifyAsync(this.data);
            yield fs.writeFile(this.dbpath, data);
        });
    }
    read() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let data = yield fs.readFile(this.dbpath, "utf8");
            this.data = yield FRON.parseAsync(data, this.path);
        });
    }
    set(path, value, ttl = 0) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let data = ttl ? [Date.now() + ttl, value] : [0, value];
            set(this.data, path, data);
            this.emit("private:set", this[oid], path, yield FRON.stringify(data));
            return this.get(path);
        });
    }
    get(path) {
        let [time, value] = get(this.data, path);
        return (!time || Date.now() - time > 0) ? value : void 0;
    }
    sync() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield new Promise((resolve, reject) => {
                let id = this.generateId();
                let timer = setTimeout(() => {
                    reject(new Error("sync failed after 5000ms timeout"));
                }, 5000);
                this.once("private:finishSync", rid => {
                    rid === id && resolve();
                    clearInterval(timer);
                }).emit("private:sync", id);
            });
            yield this.read();
        });
    }
    close() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this[state] = "closed";
            this.data = {};
            clearInterval(this.gcTimer);
            this.removeAllListeners("private:set");
            if (yield manager_process_1.isManager()) {
                yield this.flush();
            }
        });
    }
}
exports.Storage = Storage;
exports.default = Storage;
//# sourceMappingURL=index.js.map