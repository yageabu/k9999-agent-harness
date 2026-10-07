import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentEvent } from "@earendil-works/pi-durable";
import { createTranslator, fromDurable, initialRunState, type SourceEvent } from "../src/render/index.ts";

/**
 * The adapter between `pi-durable`'s events and the renderer.
 *
 * The name of an event survived the move from `pi-agent-core` and its payload did
 * not, which is the failure mode this file exists to catch: a rename is a compile
 * error and a reshaped payload is a runtime one, so nothing here may be inferred
 * from an event being called what it used to be called.
 */

const TRANSCRIPT = { model: "deepseek/deepseek-flash", cwd: "/tmp/project" };

function messageUpdate(changes: readonly unknown[]): AgentEvent {
	return { type: "message_update", usage: {} as never, changes } as unknown as AgentEvent;
}

function entry(kind: string, message: unknown, data?: unknown): { kind: string; model: unknown[]; data?: unknown } {
	return data === undefined ? { kind, model: [message] } : { kind, model: [message], data };
}

test("a text delta arrives inside changes, not on the event", () => {
	// pi-agent-core put it at `assistantMessageEvent.delta`. pi-durable puts an
	// array of changes on the event, so the delta is one level deeper and there
	// may be several in one event.
	const sources = fromDurable(messageUpdate([
		{ type: "text_delta", contentIndex: 0, delta: "hello " },
		{ type: "text_delta", contentIndex: 0, delta: "world" },
	]));
	assert.deepEqual(sources, [
		{ type: "text", text: "hello " },
		{ type: "text", text: "world" },
	]);
});

test("a thinking delta is distinguished from text", () => {
	const sources = fromDurable(messageUpdate([{ type: "thinking_delta", contentIndex: 0, delta: "hmm" }]));
	assert.deepEqual(sources, [{ type: "thinking", text: "hmm" }]);
});

test("changes that are not deltas produce nothing", () => {
	const sources = fromDurable(messageUpdate([
		{ type: "text_start", contentIndex: 0, block: {} },
		{ type: "toolcall_start", contentIndex: 1, block: {} },
	]));
	assert.deepEqual(sources, []);
});

test("the assistant message arrives inside the entry, not on the event", () => {
	// pi-agent-core: `event.message`. pi-durable: `event.entry.model[0]`.
	const sources = fromDurable({
		type: "message_end",
		entry: entry("pi.assistant", { role: "assistant", stopReason: "stop" }),
	} as unknown as AgentEvent);
	assert.equal(sources.length, 1);
	assert.equal(sources[0]?.type, "messageEnd");
});

test("an entry with no message produces nothing rather than a malformed message", () => {
	const sources = fromDurable({ type: "message_end", entry: { kind: "pi.system", model: [] } } as unknown as AgentEvent);
	assert.deepEqual(sources, []);
});

test("usage accumulates through the entry's message", () => {
	const translator = createTranslator(initialRunState(TRANSCRIPT.model, TRANSCRIPT.cwd));
	const sources = fromDurable({
		type: "message_end",
		entry: entry("pi.assistant", {
			role: "assistant",
			stopReason: "stop",
			usage: {
				input: 100,
				output: 20,
				cacheRead: 30,
				cacheWrite: 5,
				cost: { total: 0.001 },
			},
		}),
	} as unknown as AgentEvent);
	for (const source of sources) translator.translate(source);
	const items = translator.translate({ type: "turnEnd" });
	const turn = items.find((item) => item.kind === "turn");
	assert.ok(turn?.kind === "turn");
	assert.equal(turn.state.inputTokens, 135, "cache reads and writes count as input");
	assert.equal(turn.state.outputTokens, 20);
	assert.equal(turn.state.costUSD, 0.001);
});

test("a tool execution with no entry is a failure, because pi-durable omits it", () => {
	// The entry is absent when the tool task faulted or was orphaned. There is no
	// result saying anything went wrong, so a translation that treated absence as
	// success would report a broken tool as a clean run.
	const sources = fromDurable({
		type: "tool_execution_end",
		toolCallId: "c1",
		toolName: "bash",
	} as unknown as AgentEvent);
	assert.deepEqual(sources, [{ type: "toolEnd", id: "c1", name: "bash", ok: false, result: { content: undefined, details: undefined } }]);
});

test("a tool result carrying a FileChange reaches the sink as the exact lines", () => {
	// The reason the tools were ported rather than replaced: this is the data
	// SPEC 0007's first acceptance criterion is about, and it now arrives through
	// the entry's `data` rather than a `result.details`.
	const translator = createTranslator(initialRunState(TRANSCRIPT.model, TRANSCRIPT.cwd));
	const change = { path: "a.ts", line: 4, removed: ["old line"], added: ["new line"] };
	const sources = fromDurable({
		type: "tool_execution_end",
		toolCallId: "c1",
		toolName: "edit",
		entry: entry("pi.tool-result", { role: "toolResult", isError: false, content: [] }, { change }),
	} as unknown as AgentEvent);

	const items = sources.flatMap((source: SourceEvent) => translator.translate(source));
	const result = items.find((item) => item.kind === "toolResult");
	assert.ok(result?.kind === "toolResult");
	assert.deepEqual(result.change, change);
	assert.equal(result.ok, true);
});

test("an error stop reason becomes an error item rather than silence", () => {
	const translator = createTranslator(initialRunState(TRANSCRIPT.model, TRANSCRIPT.cwd));
	const sources = fromDurable({
		type: "message_end",
		entry: entry("pi.assistant", {
			role: "assistant",
			stopReason: "error",
			errorMessage: "Provider is not configured: deepseek",
		}),
	} as unknown as AgentEvent);
	const items = sources.flatMap((source: SourceEvent) => translator.translate(source));
	assert.deepEqual(items, [{ kind: "error", message: "Provider is not configured: deepseek" }]);
});

test("events the renderer does not draw produce nothing rather than throwing", () => {
	// pi-durable has more event types than the renderer draws: retries, inbox
	// changes, task failures, deferred polls. A surface must ignore what it does
	// not know about rather than fail on it.
	for (const type of ["run_start", "run_end", "turn_start", "inbox_update", "auto_retry_start", "usage_changed"]) {
		assert.deepEqual(fromDurable({ type } as unknown as AgentEvent), [], type);
	}
});
