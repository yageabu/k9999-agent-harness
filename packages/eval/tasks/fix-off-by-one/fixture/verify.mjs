import assert from "node:assert/strict";
import { countUpTo } from "./counter.mjs";

assert.equal(countUpTo(1), 1, "countUpTo(1)");
assert.equal(countUpTo(3), 6, "countUpTo(3)");
assert.equal(countUpTo(10), 55, "countUpTo(10)");

console.log("verify ok");
