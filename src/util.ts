import * as assert from "assert";

export const state = Symbol("state");
export const oid = Symbol("objectId");

export function randStr() {
    return Math.random().toString(16).slice(2);
}

export function checkState(target) {
    if (target[state] == "closed") {
        throw new ReferenceError(
            "cannot read and write data when the cache is closed."
        );
    }
}

export function isDifferent(data, origin) {
    try {
        assert.deepStrictEqual(data, origin);
        return false;
    } catch (err) {
        return true;
    }
}