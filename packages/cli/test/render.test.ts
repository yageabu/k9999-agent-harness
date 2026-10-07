import assert from "node:assert/strict";
import test from "node:test";
import type { SourceEvent } from "../src/render/index.ts";
import {
	compactNumber,
	createTextSink,
	createTranslator,
	formatCost,
	initialRunState,
	type RenderItem,
	type RenderSink,
} from "../src/render/index.ts";

// ---------------------------------------------------------------------------
// a recording sink: rendering is testable without a terminal
// ---------------------------------------------------------------------------

function recorder() {
	const items: RenderItem[] = [];
	const endStates: number[] = [];
	const sink: RenderSink = {
		name: "recorder",
		emit: (item) => void items.push(item),
		end: (state) => void endStates.push(state.turns),
	};
	return { sink, items, endStates };
}

function collector() {
	let buffer = "";
	const sink = createTextSink({
		write: (chunk) => void (buffer += chunk),
		writeText: (chunk) => void (buffer += chunk),
		color: "never",
		stream: { isTTY: false },
	});
	return { sink, text: () => buffer };
}

const TRANSCRIPT = {
	model: "deepseek/deepseek-flash",
	cwd: "/tmp/project",
};

function makeTranslator() {
	return createTranslator(initialRunState(TRANSCRIPT.model, TRANSCRIPT.cwd));
}

function textEvent(delta: string): SourceEvent {
	return { type: "text", text: delta };
}

function toolEnd(name: string, result: unknown, isError = false): SourceEvent {
	return { type: "toolEnd", id: "c1", name, ok: !isError, result };
}

// ---------------------------------------------------------------------------
// the translator: agent events become render items, and the change is data
// ---------------------------------------------------------------------------

test("an edit's change reaches the sink as the exact lines it replaced", () => {
	const translator = makeTranslator();
	const { sink, items } = recorder();

	const removed = ["\tconst sections = [authored, tools];"];
	const added = ["\tconst sections = [authored, tools, skills];"];
	const editResult = {
		content: [{ type: "text", text: "edited /tmp/project/a.ts (+1 -1)" }],
		details: {
			path: "/tmp/project/a.ts",
			replaced: 1,
			bytesBefore: 40,
			bytesAfter: 48,
			change: { path: "/tmp/project/a.ts", line: 12, removed, added },
		},
	};

	for (const item of translator.translate(toolEnd("edit", editResult))) {
		sink.emit(item);
	}

	const result = items.find((item) => item.kind === "toolResult");
	assert.ok(result?.kind === "toolResult");
	assert.deepEqual(result.change?.removed, removed, "the sink is not where the change is computed");
	assert.deepEqual(result.change?.added, added);
	assert.equal(result.change?.line, 12);
	assert.equal(result.ok, true);
});

test("a tool result without a change carries no change", () => {
	const translator = makeTranslator();
	const items = translator.translate(toolEnd("read", { content: [{ type: "text", text: "/a.ts\n1\tline" }] }));
	const result = items.find((item) => item.kind === "toolResult");
	assert.ok(result?.kind === "toolResult");
	assert.equal(result.change, undefined);
	assert.match(result.summary, /1 lines/);
});

test("a malformed change is ignored rather than thrown", () => {
	const translator = makeTranslator();
	const items = translator.translate(toolEnd("edit", { details: { change: { path: 1 } } }));
	const result = items.find((item) => item.kind === "toolResult");
	assert.ok(result?.kind === "toolResult");
	assert.equal(result.change, undefined, "a sink must not throw because a tool returned a similar shape");
});

test("usage accumulates into the run state, and turns are counted", () => {
	const translator = makeTranslator();
	translator.translate({
		type: "messageEnd",
		message: {
			role: "assistant",
			stopReason: "stop",
			usage: {
				input: 100,
				output: 20,
				cacheRead: 30,
				cacheWrite: 5,
				totalTokens: 155,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 },
			},
		},
	});

	const items = translator.translate({ type: "turnEnd" });
	const turn = items.find((item) => item.kind === "turn");
	assert.ok(turn?.kind === "turn");
	assert.equal(turn.state.turns, 1);
	assert.equal(turn.state.inputTokens, 135, "cache reads and writes count as input");
	assert.equal(turn.state.outputTokens, 20);
	assert.equal(turn.state.costUSD, 0.001);
});

test("a provider failure becomes an error item rather than silence", () => {
	const translator = makeTranslator();
	const items = translator.translate({
		type: "messageEnd",
		message: { role: "assistant", stopReason: "error", errorMessage: "Provider is not configured: deepseek" },
	});

	assert.deepEqual(items, [{ kind: "error", message: "Provider is not configured: deepseek" }]);
});

test("an aborted turn is reported even with no message from the provider", () => {
	const translator = makeTranslator();
	const items = translator.translate({
		type: "messageEnd",
		message: { role: "assistant", stopReason: "aborted" },
	});
	assert.equal(items.length, 1);
	assert.match((items[0] as { message: string }).message, /aborted/);
});

// ---------------------------------------------------------------------------
// the text sink: colour, diffs, and not breaking a streamed sentence
// ---------------------------------------------------------------------------

test("colour is off when the stream is not a TTY", () => {
	const { sink, text } = collector();
	sink.emit({ kind: "text", text: "hello" });
	sink.emit({ kind: "toolCall", id: "c", name: "read", summary: "a.ts" });
	assert.equal(text().includes("\x1b"), false, `escape sequences leaked: ${JSON.stringify(text())}`);
});

test("colour is present when the stream is a TTY", () => {
	let buffer = "";
	const sink = createTextSink({
		write: (chunk) => void (buffer += chunk),
		writeText: (chunk) => void (buffer += chunk),
		color: "always",
	});
	sink.emit({ kind: "toolCall", id: "c", name: "read", summary: "a.ts" });
	assert.equal(buffer.includes("\x1b"), true);
});

test("a tool call after streamed text does not break the sentence", () => {
	const { sink, text } = collector();
	sink.emit({ kind: "text", text: "I will read the file" });
	sink.emit({ kind: "toolCall", id: "c", name: "read", summary: "a.ts" });

	const lines = text().split("\n");
	assert.equal(lines[0], "I will read the file", "the first line must stay whole");
	assert.match(lines[1] ?? "", /read/, "the tool call starts its own line");
});

test("a tool call after text that already ended its line adds no blank line", () => {
	const { sink, text } = collector();
	sink.emit({ kind: "text", text: "done\n" });
	sink.emit({ kind: "toolCall", id: "c", name: "read", summary: "a.ts" });
	assert.equal(text().includes("\n\n"), false);
});

test("a diff shows removed and added lines distinguishably, with the line number", () => {
	let buffer = "";
	const sink = createTextSink({
		write: (chunk) => void (buffer += chunk),
		writeText: (chunk) => void (buffer += chunk),
		color: "always",
	});
	sink.emit({
		kind: "toolResult",
		id: "c1",
		name: "edit",
		ok: true,
		summary: "/tmp/a.ts  +1 -1",
		change: { path: "/tmp/a.ts", line: 12, removed: ["old line"], added: ["new line"] },
	});

	assert.match(buffer, /\/tmp\/a\.ts:12/, "the line number is shown");
	assert.match(buffer, /- old line/);
	assert.match(buffer, /\+ new line/);
	// Removed and added must be styled differently, or the diff is unreadable.
	const removed = /\x1b\[[0-9;]*m- old line/.exec(buffer)?.[0] ?? "";
	const added = /\x1b\[[0-9;]*m\+ new line/.exec(buffer)?.[0] ?? "";
	assert.notEqual(removed, "");
	assert.notEqual(added, "");
	assert.notEqual(removed, added);
});

test("a large diff is truncated rather than flooding the terminal", () => {
	const { sink, text } = collector();
	const removed = Array.from({ length: 40 }, (_, i) => `old ${i}`);
	const added = Array.from({ length: 40 }, (_, i) => `new ${i}`);
	sink.emit({
		kind: "toolResult",
		id: "c1",
		name: "edit",
		ok: true,
		summary: "big",
		change: { path: "/tmp/a.ts", line: 1, removed, added },
	});
	assert.match(text(), /more line\(s\)/);
	// Count the diff block only: its header, its body, and at most one truncation
	// note. The result line above it is not part of the budget.
	const gutter = text()
		.split("\n")
		.filter((line) => line.includes("│"));
	assert.ok(gutter.length <= 24 + 2, `diff block too long: ${gutter.length} lines`);
});

test("one per-turn line is emitted per turn, and the summary totals match", () => {
	const { sink, text } = collector();
	const base = initialRunState(TRANSCRIPT.model, TRANSCRIPT.cwd);
	const state = { ...base, turns: 1, toolCalls: 2, inputTokens: 1834, outputTokens: 220, costUSD: 0.0003 };
	sink.emit({ kind: "turn", state });
	sink.emit({ kind: "turn", state: { ...state, turns: 2, inputTokens: 3668, outputTokens: 440 } });
	sink.end?.({ ...state, turns: 2, toolCalls: 4, inputTokens: 3668, outputTokens: 440 });

	const lines = text().split("\n").filter((line) => line.includes("turn"));
	assert.equal(lines.length, 3, `expected two turn lines and one summary: ${JSON.stringify(lines)}`);
	assert.match(lines[0] ?? "", /1\.8k in/);
	assert.match(lines[1] ?? "", /3\.7k in/);
	assert.match(lines[2] ?? "", /2 turns · 4 tool calls/);
	assert.match(lines[2] ?? "", /3\.7k in \/ 440 out/);
});

test("the header is printed once, when one is given", () => {
	const { sink, text } = collector();
	void sink;
	const withHeader = (() => {
		let buffer = "";
		const created = createTextSink({
			write: (chunk) => void (buffer += chunk),
			color: "never",
			header: "Code Agent · deepseek/deepseek-flash · /tmp",
		});
		void created;
		return buffer;
	})();
	assert.match(withHeader, /^Code Agent/);
});

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

test("numbers are compacted for a glance, not for an audit", () => {
	assert.equal(compactNumber(0), "0");
	assert.equal(compactNumber(999), "999");
	assert.equal(compactNumber(1834), "1.8k");
	assert.equal(compactNumber(1_500_000), "1.5M");
	assert.equal(formatCost(0), "$0");
	assert.equal(formatCost(0.0003), "$0.0003");
	assert.equal(formatCost(1.2345), "$1.2345");
});
