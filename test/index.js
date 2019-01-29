const cluster = require("cluster");
const assert = require("assert");
const path = require("path");
const fs = require("fs-extra");
const { __awaiter } = require("tslib");

function sleep(timeout) {
    return new Promise(resolve => setTimeout(resolve, timeout));
}

if (cluster.isMaster) {
    let WORKER_ID = 10001;

    cluster.on("message", (worker, msg) => {
        switch (msg.event) {
            case "addWorker":
                cluster.fork({ WORKER_ID: WORKER_ID++ });
                break;

            case "exitTest":
                process.exit();
                break;

            case "error":
                console.log(msg.message);
                process.exit(msg.code || 1);
                break;
        }
    });

    for (let i = 0; i < 2; i++) {
        cluster.fork({ WORKER_ID: WORKER_ID++ });
    }
} else {
    const { WORKER_ID } = process.env;
    const { Cache } = require("..");

    var cache = new Cache("test", { path: __dirname, gcInterval: 3000 });

    __awaiter(void 0, void 0, null, function* () {
        try {
            yield sleep(1000);

            let data = "Hello, World!";

            if (WORKER_ID == "10001") {
                assert.strictEqual(cache.name, "test");
                assert.strictEqual(cache.closed, false);
                assert.strictEqual(cache.connected, true);
                assert.strictEqual(cache.filename, path.resolve(__dirname, "test.cache"));
                assert.strictEqual(cache.gcInterval, 3000);
                assert.strictEqual(cache.path, __dirname);
                console.log("Check cache instance: OK");

                let setData = cache.set("foo", data);
                let getData = cache.get("foo");

                assert.strictEqual(setData, data);
                assert.strictEqual(getData, data);
                console.log("Set and get data: OK");

                setData = cache.set("foo-ttl-2000", data, 2000);
                getData = cache.get("foo-ttl-2000");

                assert.strictEqual(setData, data);
                assert.strictEqual(getData, data);
                yield sleep(2000);
                assert.strictEqual(cache.get("foo-ttl-2000"), null);
                console.log("Set and get data with TTL: OK");

                cache.set("foo-will-be-delete", data);
                assert.strictEqual(cache.get("foo-will-be-delete"), data);
                yield sleep(50); // wait a while for deletion
                cache.delete("foo-will-be-delete");
                assert.strictEqual(cache.get("foo-will-be-delete"), null);
                console.log("Delete data: OK");

                yield sleep(5000);
                assert.deepStrictEqual(cache.data, { foo: data });
                console.log("Check GC: OK");

                let fileData = JSON.parse(yield fs.readFile(cache.filename, "utf8"));
                assert.deepStrictEqual(fileData, {
                    lives: {},
                    data: {
                        foo: "Hello, World!"
                    }
                });
                console.log("Check file copy: OK");
            } else if (WORKER_ID == "10002") {
                yield sleep(50); // make sure this process runs after the above one.
                assert.strictEqual(cache.get("foo"), data);
                console.log("Get data in another worker: OK");

                assert.strictEqual(cache.get("foo-ttl-2000"), data);
                yield sleep(2000);
                assert.strictEqual(cache.get("foo-ttl-2000"), null);
                console.log("Get data with TTL in another worker: OK");

                assert.strictEqual(cache.get("foo-will-be-delete"), data);
                yield sleep(50); // wait a while for deletion
                assert.strictEqual(cache.get("foo-will-be-delete"), null);
                console.log("Delete data in another worker: OK");

                yield sleep(5000);
                assert.deepStrictEqual(cache.data, { foo: data });
                console.log("Check GC in another worker: OK");

                process.send({ event: "addWorker" });
            } else if (WORKER_ID == "10003") {
                yield cache.sync();

                assert.strictEqual(cache.get("foo"), data);
                console.log("Sync data in new worker: OK");

                process.send({ event: "exitTest" });
            }
        } catch (err) {
            process.send({ event: "error", message: err.stack });
        }
    });
}