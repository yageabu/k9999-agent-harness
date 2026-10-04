import assert from "node:assert/strict";
import { total } from "./sum.mjs";

assert.equal(typeof total, "function", "total must be exported as a function");
assert.equal(total([]), 0, "the sum of no rows");
assert.equal(
	total([
		{ region: "north", amount: 120 },
		{ region: "south", amount: 80 },
		{ region: "north", amount: 45 },
		{ region: "east", amount: 15 },
	]),
	260,
	"the sample rows",
);

console.log("verify ok");
