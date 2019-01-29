"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
exports.state = Symbol("state");
exports.oid = Symbol("objectId");
function randStr() {
    return Math.random().toString(16).slice(2);
}
exports.randStr = randStr;
function checkState(target) {
    if (target[exports.state] == "closed") {
        throw new ReferenceError("cannot read and write data when the cache is closed.");
    }
}
exports.checkState = checkState;
function isDifferent(data, origin) {
    try {
        assert.deepStrictEqual(data, origin);
        return false;
    }
    catch (err) {
        return true;
    }
}
exports.isDifferent = isDifferent;
//# sourceMappingURL=util.js.map