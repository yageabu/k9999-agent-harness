import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth, type Terminal } from "@earendil-works/pi-tui";
import { createStyler, lineStyle } from "../src/render/layout.ts";
import { initialRunState, type RenderItem } from "../src/render/vocabulary.ts";
import { createTuiApp } from "../src/tui/index.ts";
import { TranscriptView } from "../src/tui/transcript.ts";

/**
 * A Terminal that records instead of drawing.
 *
 * The TUI takes its terminal by injection, which is what makes it testable
 * without an interactive session: frames can be captured and asserted on.
 */
export function headlessTerminal(columns = 80, rows = 24) {
	const written: string[] = [];
	let input: ((data: string) => void) | undefined;
	let width = columns;

	const terminal: Terminal = {
		start(onInput) {
			input = onInput;
		},
		stop() {},
		drainInput: async () => {},
		write: (data) => void written.push(data),
		get columns() {
			return width;
		},
		get rows() {
			return rows;
		},
		get kittyProtocolActive() {
			return false;
		},
		moveBy() {},
		hideCursor() {},
		showCursor() {},
		clearLine() {},
		clearFromCursor() {},
		clearScreen() {},
		setTitle() {},
		setProgress() {},
	};

	return {
		terminal,
		frame: () => written.join(""),
		clear: () => void (written.length = 0),
		send: (data: string) => input?.(data),
		resize: (next: number) => void (width = next),
	};
}


/** The facts a surface reports, with everything a test does not care about defaulted. */
function facts(overrides: Record<string, unknown> = {}) {
	return {
		version: "0.0.0-test",
		profile: "Code Agent",
		cwd: "/tmp/project",
		model: "deepseek/deepseek-flash",
		modelName: "deepseek-flash",
		provider: "deepseek",
		thinking: "high",
		contextWindow: 1_000_000,
		contextTokens: () => 0,
		color: "never" as const,
		...overrides,
	};
}

function createApp(term: ReturnType<typeof headlessTerminal>, onSubmit: (text: string) => Promise<void>) {
	return createTuiApp({ terminal: term.terminal, facts: facts(), onSubmit, onExit: () => {} });
}

function view(budget = 20) {
	const style = lineStyle(createStyler(false), "/tmp/project", 24);
	return new TranscriptView({ style, budget: () => budget });
}

function text(delta: string): RenderItem {
	return { kind: "text", text: delta };
}

// ---------------------------------------------------------------------------
// the transcript
// ---------------------------------------------------------------------------

test("streamed deltas become one paragraph", () => {
	const transcript = view();
	for (const chunk of ["The ", "prompt ", "is ", "assembled."]) {
		transcript.append(text(chunk));
	}
	const lines = transcript.render(60);
	assert.equal(lines.length, 1);
	assert.match(lines[0] ?? "", /^The prompt is assembled\./);
});

test("a tool call splits two replies instead of merging across it", () => {
	const transcript = view();
	transcript.append(text("before"));
	transcript.append({ kind: "toolCall", id: "c", name: "read", summary: "a.ts" });
	transcript.append(text("after"));
	// Strip the padding each line carries so the assertion is about content.
	const flat = transcript
		.render(60)
		.map((line) => line.trimEnd())
		.join("\n");
	assert.match(flat, /before/);
	assert.match(flat, /after/);
	// "before" and "after" must not end up adjacent, or the transcript lies
	// about the order of what happened.
	assert.match(flat, /before\n.*read.*\nafter/s);
});

test("the last lines are shown, not the first", () => {
	const transcript = view(3);
	for (let i = 1; i <= 10; i += 1) {
		transcript.append({ kind: "toolCall", id: `c${i}`, name: "read", summary: `file-${i}.ts` });
	}
	const lines = transcript.render(60).join("\n");
	assert.match(lines, /file-10\.ts/, "the newest line must be visible");
	assert.equal(lines.includes("file-1.ts"), false, "the oldest must have scrolled away");
	assert.equal(lines.split("\n").length, 3);
});

test("every rendered line is exactly the requested width", () => {
	const transcript = view();
	transcript.append(text("short"));
	transcript.append(text("a line that is definitely longer than the width it will be rendered into"));
	transcript.append({
		kind: "toolResult",
		id: "c",
		name: "edit",
		ok: true,
		summary: "a.ts  +1 -1",
		change: { path: "/tmp/project/a.ts", line: 3, removed: ["i < n"], added: ["i <= n"] },
	});

	for (const width of [20, 40, 80, 120]) {
		for (const line of transcript.render(width)) {
			assert.equal(visibleWidth(line), width, `width ${width}: ${JSON.stringify(line)}`);
		}
	}
});

test("wide characters are measured as columns, not characters", () => {
	const transcript = view();
	transcript.append(text("中文中文中文中文中文中文中文中文中文中文"));
	for (const line of transcript.render(21)) {
		assert.equal(visibleWidth(line), 21);
	}
});

test("a diff reaches the transcript with its line number", () => {
	const transcript = view();
	transcript.append({
		kind: "toolResult",
		id: "c",
		name: "edit",
		ok: true,
		summary: "a.ts  +1 -1",
		change: { path: "/tmp/project/a.ts", line: 12, removed: ["old"], added: ["new"] },
	});
	const flat = transcript.render(60).join("\n");
	assert.match(flat, /a\.ts:12/, "paths are shortened against cwd and the line is shown");
	assert.match(flat, /- old/);
	assert.match(flat, /\+ new/);
});

test("the summary line arrives through end()", () => {
	const transcript = view();
	const state = { ...initialRunState({
		model: "deepseek/deepseek-flash",
		modelName: "deepseek-flash",
		provider: "deepseek",
		thinking: "high",
		cwd: "/tmp/project",
		contextWindow: 1_000_000,
	}), turns: 2, toolCalls: 3 };
	transcript.end(state);
	assert.match(transcript.render(80).join("\n"), /2 turns · 3 tool calls/);
});

// ---------------------------------------------------------------------------
// the app
// ---------------------------------------------------------------------------

test("the TUI starts, accepts input, and draws frames", async () => {
	const term = headlessTerminal(80, 24);
	let submitted: string | undefined;
	const instance = createApp(term, async (value) => void (submitted = value));
	const app = instance;

	app.sink.emit({ kind: "toolCall", id: "c", name: "read", summary: "counter.mjs" });
	app.start();
	await new Promise((resolve) => setTimeout(resolve, 60));

	const frame = term.frame();
	assert.match(frame, /read/, "the transcript reached the terminal");
	assert.match(frame, /deepseek-flash/, "the status header is drawn");

	// Typed input arrives one key at a time, which is the case this covers. The
	// coalesced form is asserted separately below.
	term.send("hello");
	await new Promise((resolve) => setTimeout(resolve, 40));
	term.send("\r");
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.equal(submitted, "hello");

	app.stop();
});

test("text and Enter in one chunk is treated as a paste, and does not submit", async () => {
	// Recorded rather than fixed: the editor belongs to pi-tui, and not
	// submitting a paste that happens to end in a newline is defensible. The
	// cost is that a terminal which coalesces fast typing would swallow the
	// Enter. A real terminal delivers keys separately, so this is an edge case
	// worth knowing about rather than one worth working around.
	const term = headlessTerminal(80, 24);
	let submitted: string | undefined;
	const instance = createApp(term, async (value) => void (submitted = value));
	const app = instance;
	app.start();
	await new Promise((resolve) => setTimeout(resolve, 50));

	term.send("hello\r");
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.equal(submitted, undefined);

	app.stop();
});

test("the summary reaches the terminal when the run ends", async () => {
	const term = headlessTerminal(80, 24);
	const instance = createApp(term, async () => {});
	const app = instance;
	app.sink.end({ ...initialRunState({
		model: "deepseek/deepseek-flash",
		modelName: "deepseek-flash",
		provider: "deepseek",
		thinking: "high",
		cwd: "/tmp/project",
		contextWindow: 1_000_000,
	}), turns: 1, toolCalls: 2, inputTokens: 1834 });
	app.start();
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.match(term.frame(), /1 turn · 2 tool calls · 1\.8k in/);
	app.stop();
});
