"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const path = require("path");
const fs = require("fs-extra");
const cluster_events_1 = require("cluster-events");
const manager_process_1 = require("manager-process");
const set = require("lodash/set");
const get = require("lodash/get");
const pick = require("lodash/pick");
const unset = require("lodash/unset");
const clone = require("lodash/cloneDeep");
const state = Symbol("state");
const oid = Symbol("objectId");
class Cache extends cluster_events_1.EventEmitter {
    constructor(name, options = {}) {
        super(name);
        this.data = {};
        this.lives = {};
        this[oid] = this.generateId();
        this[state] = "connected";
        this.name = this.id;
        this.path = options.path || process.cwd();
        this.gcInterval = options.gcInterval || 120000;
        this.gcTimer = setInterval(() => tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.gc();
            if (yield manager_process_1.isManager()) {
                yield this.flush();
            }
        }), this.gcInterval);
        this.on("private:set", (id, path, data, life) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (id !== this[oid] && this.connected) {
                set(this.data, path, data);
                life && (this.lives[path] = life);
            }
        })).on("private:sync", (id) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (yield manager_process_1.isManager()) {
                yield this.flush();
                this.emit("private:finishSync", id);
            }
        }));
    }
    get filename() {
        return path.resolve(this.path, this.name + ".cache");
    }
    get connected() {
        return !this.closed;
    }
    get closed() {
        return this[state] == "closed";
    }
    checkState() {
        if (this[state] == "closed") {
            throw new ReferenceError("cannot read and write data when the cache is closed.");
        }
    }
    generateId() {
        return Math.random().toString(16).slice(2);
    }
    gc() {
        let now = Date.now();
        for (let path in this.lives) {
            if (this.lives[path] < now) {
                unset(this.data, path);
                delete this.lives[path];
            }
        }
    }
    flush() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield fs.writeFile(this.filename, JSON.stringify(pick(this, [
                "lives",
                "data"
            ])), "utf8");
        });
    }
    read() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let data = yield fs.readFile(this.filename, "utf8");
            Object.assign(this, pick(JSON.parse(data), ["lives", "data"]));
        });
    }
    set(path, data, ttl = 0) {
        this.checkState();
        set(this.data, path, JSON.parse(JSON.stringify(data)));
        if (ttl) {
            this.lives[path] = Date.now() + ttl;
        }
        this.emit("private:set", this[oid], path, data, this.lives[path]);
        return this.get(path);
    }
    get(path) {
        let data = null;
        this.checkState();
        if (!this.lives[path] || Date.now() < this.lives[path]) {
            data = get(this.data, path, null);
        }
        return Promise.resolve(clone(data));
    }
    delete(path) {
        this.checkState();
        unset(this.data, path);
        delete this.lives[path];
        return Promise.resolve(void 0);
    }
    sync() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.checkState();
            yield new Promise((resolve, reject) => {
                let id = this.generateId();
                let timer = setTimeout(() => {
                    reject(new Error("sync data failed after 5000ms timeout."));
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
            this.checkState();
            if (yield manager_process_1.isManager()) {
                yield this.flush();
            }
            this[state] = "closed";
            this.data = {};
            this.lives = {};
            this.removeAllListeners("private:set");
            clearInterval(this.gcTimer);
        });
    }
    destroy() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.checkState();
            this[state] = "closed";
            this.data = {};
            this.lives = {};
            this.removeAllListeners("private:set");
            clearInterval(this.gcTimer);
            yield fs.unlink(this.filename);
        });
    }
}
exports.Cache = Cache;
exports.default = Cache;
//# sourceMappingURL=index.js.map