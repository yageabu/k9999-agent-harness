import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { visibleWidth } from "@earendil-works/pi-tui";
import { contextTokens } from "../src/context.ts";
import { createStyler } from "../src/render/format.ts";
import { initialRunState, type RunState } from "../src/render/vocabulary.ts";
import { bannerLines, cacheLabel, contextLabel, StatusHeader } from "../src/tui/header.ts";

const plain = createStyler(false);

function state(overrides: Partial<RunState> = {}): RunState {
	return {
		...initialRunState({
			model: "deepseek/deepseek-flash",
			modelName: "deepseek-flash",
			provider: "deepseek",
			thinking: "high",
			cwd: "/home/abu/code/upstream",
			contextWindow: 1_000_000,
		}),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// the startup banner
// ---------------------------------------------------------------------------

test("the banner carries the four facts beside the mark", () => {
	const lines = bannerLines(
		{
			version: "0.4.1",
			profile: "Code Agent",
			model: "deepseek/deepseek-flash",
			thinking: "high",
			cwd: "/home/abu/code/upstream",
		},
		plain,
		120,
	);
	const text = lines.join("\n");
	assert.equal(lines.length, 6, "five lines of mark and facts, then a blank");
	assert.match(text, /K9999 Agent Harness/);
	assert.match(text, /0\.4\.1/);
	assert.match(text, /Code Agent/);
	assert.match(text, /deepseek\/deepseek-flash · high/);
	assert.match(text, /\/home\/abu\/code\/upstream/);
	assert.match(text, /9999/, "the mark itself");
});

test("a narrow terminal drops the mark rather than wrapping it", () => {
	// A wrapped logo is worse than no logo.
	// A working directory long enough that the mark cannot share the line.
	const cwd = "/home/abu/code/a-very-long-project-name-indeed";
	const lines = bannerLines(
		{ version: "0.4.1", profile: "Code Agent", model: "m", thinking: "high", cwd },
		plain,
		50,
	);
	assert.equal(lines.some((line) => line.includes("┌")), false, "the mark is dropped, not wrapped");
	assert.match(lines.join("\n"), /K9999 Agent Harness/);
	assert.match(lines.join("\n"), new RegExp(cwd));
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= 50, `too wide: ${JSON.stringify(line)}`);
	}
});

// ---------------------------------------------------------------------------
// the status figures
// ---------------------------------------------------------------------------

test("context reads as what is left, against the ceiling", () => {
	assert.equal(contextLabel(state({ contextTokens: 0 })), "100.0%/1.0M");
	assert.equal(contextLabel(state({ contextTokens: 87_000 })), "91.3%/1.0M");
	assert.equal(contextLabel(state({ contextTokens: 1_000_000 })), "0.0%/1.0M");
	// Over the ceiling is not a negative number to show a reader.
	assert.equal(contextLabel(state({ contextTokens: 1_200_000 })), "0.0%/1.0M");
	assert.equal(contextLabel(state({ contextWindow: 0 })), "—", "an unknown window is not a figure");
});

test("the cache share is absent when the provider reports nothing", () => {
	// Zero would read as "no cache hits" when it means "not reported".
	assert.equal(cacheLabel(state({ inputTokens: 1000, cacheRead: 0 })), undefined);
	assert.equal(cacheLabel(state({ inputTokens: 1000, cacheRead: 900 })), "c 90.0%");
	assert.equal(cacheLabel(state({ inputTokens: 1000, cacheRead: 1000 })), "c 100.0%");
});

test("the status header is three lines: model, rule, facts", () => {
	const header = new StatusHeader(state({ turns: 4, toolCalls: 3, inputTokens: 323_000, outputTokens: 678_000, cacheRead: 323_000, costUSD: 3.097 }), plain);
	const lines = header.render(80);
	assert.equal(lines.length, 3);
	assert.match(lines[0] ?? "", /deepseek-flash\s+Deepseek\s+high/);
	assert.match(lines[1] ?? "", /^─+$/);
	assert.match(lines[2] ?? "", /upstream/);
	assert.match(lines[2] ?? "", /100\.0%\/1\.0M/);
	assert.match(lines[2] ?? "", /↑323k ↓678k/);
	assert.match(lines[2] ?? "", /c 100\.0%/);
	assert.match(lines[2] ?? "", /\$3\.097/);
});

test("reasoning tokens appear only when the provider reported them", () => {
	const without = new StatusHeader(state(), plain).render(80)[2] ?? "";
	assert.equal(without.includes("R"), false);

	const withReasoning = new StatusHeader(state({ reasoningTokens: 364_000 }), plain).render(80)[2] ?? "";
	assert.match(withReasoning, /R364k/);
});

test("cost is absent until something has been spent", () => {
	assert.equal((new StatusHeader(state(), plain).render(80)[2] ?? "").includes("$"), false);
});

test("no line is wider than the terminal", () => {
	const header = new StatusHeader(state({ inputTokens: 323_000, outputTokens: 678_000, cacheRead: 323_000, reasoningTokens: 364_000, costUSD: 3.097 }), plain);
	for (const width of [40, 80, 120]) {
		for (const line of header.render(width)) {
			assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
		}
	}
});

// ---------------------------------------------------------------------------
// reading the context size from the session
// ---------------------------------------------------------------------------

test("the reported usage is preferred over an estimate", () => {
	const messages = [
		{ role: "user", content: "hello" },
		{ role: "assistant", content: [{ type: "text", text: "hi" }], usage: { input: 800, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 820 } },
	] as unknown as AgentMessage[];
	// 820 measured, not the handful of characters those two messages hold.
	assert.equal(contextTokens(messages), 820);
});

test("messages after the reported usage are estimated and added", () => {
	const trail = "x".repeat(400);
	const messages = [
		{ role: "assistant", content: [], usage: { input: 800, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 820 } },
		{ role: "toolResult", content: [{ type: "text", text: trail }] },
	] as unknown as AgentMessage[];
	assert.equal(contextTokens(messages), 820 + 100, "400 characters is 100 tokens at four per token");
});

test("with nothing reported, everything is estimated", () => {
	const messages = [{ role: "user", content: "a".repeat(40) }] as unknown as AgentMessage[];
	assert.equal(contextTokens(messages), 10);
	assert.equal(contextTokens([]), 0);
});

test("a zero usage block is skipped rather than trusted", () => {
	const messages = [
		{ role: "assistant", content: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } },
		{ role: "user", content: "a".repeat(40) },
	] as unknown as AgentMessage[];
	assert.equal(contextTokens(messages), 10);
});
