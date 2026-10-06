import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { LAUNCH_NAMES } from "../src/launch.ts";
import { logoLines, logoWidth } from "../src/tui/logo.ts";

test("every launch command has a block logo", () => {
	for (const { command } of LAUNCH_NAMES) {
		const block = logoLines(command);
		assert.ok(block !== undefined, `${command} has no block`);
		assert.equal(block.length, 6, "six rows is what the font produces");
	}
});

test("a block carries no trailing whitespace, so the version can follow it", () => {
	for (const { command } of LAUNCH_NAMES) {
		for (const line of logoLines(command) ?? []) {
			assert.equal(line, line.replace(/\s+$/, ""), `${command}: ${JSON.stringify(line)}`);
		}
	}
});

test("the art stays inside the width it reports", () => {
	for (const { command } of LAUNCH_NAMES) {
		const block = logoLines(command) ?? [];
		for (const line of block) {
			assert.ok(visibleWidth(line) <= logoWidth(block), `${command}: ${JSON.stringify(line)}`);
		}
	}
	// The version sits after the art, so the block has to leave room for it at
	// the widths a terminal actually has.
	assert.ok(logoWidth(logoLines("k9999") ?? []) <= 40);
	assert.ok(logoWidth(logoLines("kula") ?? []) <= 33);
});

test("a name with no block is not an error", () => {
	assert.equal(logoLines("something-else"), undefined);
});
