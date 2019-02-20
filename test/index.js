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
    const { Storage } = require("..");

    var store = new Storage("test", { path: __dirname, gcInterval: 3000 });

    __awaiter(void 0, void 0, null, function* () {
        try {
            yield sleep(1000);

            let data = "Hello, World!";

            if (WORKER_ID == "10001") {
                assert.strictEqual(store.name, "test");
                assert.strictEqual(store.closed, false);
                assert.strictEqual(store.connected, true);
                assert.strictEqual(store.filename, path.resolve(__dirname, "test.db"));
                assert.strictEqual(store.gcInterval, 3000);
                assert.strictEqual(store.path, __dirname);
                console.log("Check storage instance: OK");

                let setData = store.set("foo", data);
                let getData = store.get("foo");

                assert.strictEqual(setData, data);
                assert.strictEqual(getData, data);
                assert.strictEqual(store.has("foo"), true);
                console.log("Set and get data: OK");

                setData = store.set("foo-ttl-2000", data, 2000);
                getData = store.get("foo-ttl-2000");

                assert.strictEqual(setData, data);
                assert.strictEqual(getData, data);
                assert.strictEqual(store.has("foo-ttl-2000"), true);
                yield sleep(2000);
                assert.strictEqual(store.has("foo-ttl-2000"), false);
                assert.strictEqual(store.get("foo-ttl-2000"), null);
                console.log("Set and get data with TTL: OK");

                store.set("foo-will-be-delete", data);
                assert.strictEqual(store.get("foo-will-be-delete"), data);
                yield sleep(100); // wait a while for deletion
                store.delete("foo-will-be-delete");
                assert.strictEqual(store.has("foo-will-be-delete"), false);
                assert.strictEqual(store.get("foo-will-be-delete"), null);
                console.log("Delete data: OK");

                yield sleep(5000);
                assert.deepStrictEqual(store.data, { foo: data });
                console.log("Check GC: OK");

                let fileData = JSON.parse(yield fs.readFile(store.filename, "utf8"));
                assert.deepStrictEqual(fileData, {
                    lives: {},
                    data: {
                        foo: "Hello, World!"
                    }
                });
                console.log("Check file copy: OK");
            } else if (WORKER_ID == "10002") {
                yield sleep(50); // make sure this process runs after the above one.

                assert.strictEqual(store.has("foo"), true);
                assert.strictEqual(store.get("foo"), data);
                console.log("Get data in another worker: OK");

                assert.strictEqual(store.has("foo-ttl-2000"), true);
                assert.strictEqual(store.get("foo-ttl-2000"), data);
                yield sleep(2000);
                assert.strictEqual(store.has("foo-ttl-2000"), false);
                assert.strictEqual(store.get("foo-ttl-2000"), null);
                console.log("Get data with TTL in another worker: OK");

                assert.strictEqual(store.get("foo-will-be-delete"), data);
                yield sleep(100); // wait a while for deletion
                assert.strictEqual(store.has("foo-will-be-delete"), false);
                assert.strictEqual(store.get("foo-will-be-delete"), null);
                console.log("Delete data in another worker: OK");

                yield sleep(5000);
                assert.deepStrictEqual(store.data, { foo: data });
                console.log("Check GC in another worker: OK");

                process.send({ event: "addWorker" });
            } else if (WORKER_ID == "10003") {
                yield store.sync();

                assert.strictEqual(store.get("foo"), data);
                assert.strictEqual(store.has("foo"), true);
                console.log("Sync data in new worker: OK");

                process.send({ event: "exitTest" });
            }
        } catch (err) {
            process.send({ event: "error", message: err.stack });
        }
    });
}