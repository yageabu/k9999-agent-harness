import assert from "node:assert/strict";
import test from "node:test";
import { createRenderer, summarizeArgs } from "../src/renderer.ts";

function capture(): { written: () => string; sink: { write(chunk: string): void } } {
	let buffer = "";
	return {
		sink: {
			write(chunk: string): void {
				buffer += chunk;
			},
		},
		written: () => buffer,
	};
}

test("text deltas are written and mark the turn as having output", () => {
	const output = capture();
	const renderer = createRenderer(output.sink);

	renderer.handle({
		type: "message_update",
		message: { role: "assistant" },
		assistantMessageEvent: { type: "text_delta", delta: "hello" },
	} as never);

	assert.equal(output.written(), "hello");
	assert.equal(renderer.state.wroteText, true);
	assert.equal(renderer.state.error, undefined);
});

test("a provider failure becomes a recorded error instead of silent success", () => {
	const output = capture();
	const renderer = createRenderer(output.sink);

	renderer.handle({
		type: "message_end",
		message: { role: "assistant", stopReason: "error", errorMessage: "Provider is not configured: deepseek" },
	} as never);

	assert.equal(renderer.state.error, "Provider is not configured: deepseek");
});

test("an aborted turn is recorded even with no message from the provider", () => {
	const output = capture();
	const renderer = createRenderer(output.sink);

	renderer.handle({ type: "message_end", message: { role: "assistant", stopReason: "aborted" } } as never);

	assert.match(renderer.state.error ?? "", /stop reason "aborted"/);
});

test("a successful assistant message clears nothing and records nothing", () => {
	const output = capture();
	const renderer = createRenderer(output.sink);

	renderer.handle({ type: "message_end", message: { role: "assistant", stopReason: "stop" } } as never);

	assert.equal(renderer.state.error, undefined);
});

test("a failed tool records an error and still reports the tool line", () => {
	const output = capture();
	const renderer = createRenderer(output.sink);

	renderer.handle({
		type: "tool_execution_end",
		toolName: "bash",
		isError: true,
	} as never);

	assert.equal(renderer.state.error, "tool bash failed");
	assert.match(output.written(), /\[bash\] failed/);
});

test("only the first failure is kept", () => {
	const output = capture();
	const renderer = createRenderer(output.sink);

	renderer.handle({
		type: "tool_execution_end",
		toolName: "bash",
		isError: true,
	} as never);
	renderer.handle({
		type: "message_end",
		message: { role: "assistant", stopReason: "error", errorMessage: "second" },
	} as never);

	assert.equal(renderer.state.error, "tool bash failed");
});

test("a tool call line prefers the command, then the path", () => {
	assert.equal(summarizeArgs({ command: "npm test", path: "a.txt" }), "npm test");
	assert.equal(summarizeArgs({ path: "src/index.ts" }), "src/index.ts");
	assert.equal(summarizeArgs({ other: 1 }), "");
	assert.equal(summarizeArgs("not an object"), "");
	assert.equal(summarizeArgs({ command: "x".repeat(200) }).endsWith("..."), true);
});
