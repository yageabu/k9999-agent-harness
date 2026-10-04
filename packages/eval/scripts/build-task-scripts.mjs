#!/usr/bin/env node
/**
 * Write each task's script.json.
 *
 * A script is a recorded sequence of model responses. It lets the task set run
 * with no network and no credentials, which is what makes it usable as a
 * regression check — and it is the same data `replay` consumes.
 *
 * These are bootstrapped by hand rather than recorded from a real run, so they
 * describe a competent agent doing the task, not a particular model. Once a
 * real provider is configured, refresh a task's script from a recording of that
 * run instead of editing this file.
 *
 *   npm run eval:scripts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";

const tasksDir = path.resolve(import.meta.dirname, "../tasks");

const toolUse = (calls) => fauxAssistantMessage(calls, { stopReason: "toolUse" });
const done = (text) => fauxAssistantMessage(text, { stopReason: "stop" });

const SCRIPTS = {
	"fix-off-by-one": [
		toolUse([fauxToolCall("read", { path: "counter.mjs" })]),
		toolUse([
			fauxToolCall("edit", {
				path: "counter.mjs",
				oldText: "for (let index = 1; index < n; index += 1) {",
				newText: "for (let index = 1; index <= n; index += 1) {",
			}),
		]),
		toolUse([fauxToolCall("bash", { command: "node verify.mjs" })]),
		done("`counter.mjs` summed 1..n-1 because the loop used `index < n`. Changed it to `index <= n`. `node verify.mjs` printed `verify ok`."),
	],

	"count-errors": [
		toolUse([fauxToolCall("read", { path: "data.txt" })]),
		toolUse([fauxToolCall("bash", { command: "grep -c ' ERROR ' data.txt > count.txt" })]),
		done("6 lines have level `ERROR`. Wrote `6` to `count.txt`."),
	],

	"write-sum-module": [
		toolUse([fauxToolCall("read", { path: "verify.mjs" })]),
		toolUse([
			fauxToolCall("bash", {
				command: [
					"cat > sum.mjs <<'EOF'",
					"/**",
					" * Sum the amount of every row.",
					" *",
					" * @param {Array<{ region: string, amount: number }>} rows",
					" * @returns {number}",
					" */",
					"export function total(rows) {",
					"\treturn rows.reduce((sum, row) => sum + row.amount, 0);",
					"}",
					"EOF",
				].join("\n"),
			}),
		]),
		toolUse([fauxToolCall("bash", { command: "node verify.mjs" })]),
		done("Created `sum.mjs` exporting `total(rows)`, which sums every `amount` and returns 0 for an empty array. `node verify.mjs` printed `verify ok`."),
	],
};

for (const [id, script] of Object.entries(SCRIPTS)) {
	const dir = path.join(tasksDir, id);
	await mkdir(dir, { recursive: true });
	const file = path.join(dir, "script.json");
	await writeFile(file, `${JSON.stringify(script, null, "\t")}\n`, "utf8");
	process.stdout.write(`${id}: ${script.length} response(s) -> ${path.relative(process.cwd(), file)}\n`);
}
