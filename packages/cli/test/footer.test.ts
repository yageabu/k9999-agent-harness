import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createStyler } from "../src/render/format.ts";
import { initialRunState, type RunState } from "../src/render/vocabulary.ts";
import { cacheLabel, contextLabel, contextPercent, Footer } from "../src/tui/footer.ts";

const plain = createStyler(false);

function state(overrides: Partial<RunState> = {}): RunState {
	return {
		...initialRunState({
			model: "deepseek/deepseek-flash",
			modelName: "deepseek-flash",
			provider: "deepseek",
			thinking: "medium",
			cwd: "/home/dev/project",
			contextWindow: 1_000_000,
		}),
		...overrides,
	};
}

function footer(run: RunState, branch?: string) {
	return new Footer({
		state: run,
		style: plain,
		...(branch === undefined ? {} : { branch: () => branch }),
		home: "/home/dev",
	});
}

// ---------------------------------------------------------------------------
// the figures
// ---------------------------------------------------------------------------

test("context reads as what is left, against the ceiling", () => {
	assert.equal(contextLabel(state({ contextTokens: 0 })), "100.0%/1.0M");
	assert.equal(contextLabel(state({ contextTokens: 87_000 })), "91.3%/1.0M");
	assert.equal(contextLabel(state({ contextTokens: 1_000_000 })), "0.0%/1.0M");
	// Over the ceiling is not a negative number to show a reader.
	assert.equal(contextLabel(state({ contextTokens: 1_200_000 })), "0.0%/1.0M");
	assert.equal(contextLabel(state({ contextWindow: 0 })), "—", "an unknown window is not a figure");
});

test("the remaining share is the number the colour is chosen from", () => {
	assert.equal(contextPercent(state({ contextTokens: 0 })), 100);
	assert.equal(contextPercent(state({ contextTokens: 950_000 })), 5);
	assert.equal(contextPercent(state({ contextWindow: 0 })), 0);
});

test("the cache share is absent when the provider reports nothing", () => {
	// Zero would read as "no cache hits" when it means "not reported".
	assert.equal(cacheLabel(state({ inputTokens: 1000, cacheRead: 0 })), undefined);
	assert.equal(cacheLabel(state({ inputTokens: 1000, cacheRead: 900 })), "c 90.0%");
	assert.equal(cacheLabel(state({ inputTokens: 1000, cacheRead: 1000 })), "c 100.0%");
});

// ---------------------------------------------------------------------------
// the location line
// ---------------------------------------------------------------------------

test("the location line shortens the home directory and names the branch", () => {
	assert.equal(footer(state(), "main").render(80)[0], "~/project (main)");
});

test("a repository with no branch shows no parentheses", () => {
	const withoutGit = new Footer({ state: state(), style: plain, home: "/home/dev" });
	assert.equal(withoutGit.render(80)[0], "~/project");
});

test("a directory outside the home directory is left alone", () => {
	const elsewhere = new Footer({
		state: state({ cwd: "/srv/work" }),
		style: plain,
		home: "/home/dev",
	});
	assert.equal(elsewhere.render(80)[0], "/srv/work");
});

// ---------------------------------------------------------------------------
// the totals line
// ---------------------------------------------------------------------------

test("the model and its thinking level sit at the right edge", () => {
	const line = footer(state({ inputTokens: 1834, outputTokens: 220, costUSD: 0.0003 }), "main").render(80)[1] ?? "";
	assert.equal(visibleWidth(line), 80);
	assert.match(line, /deepseek-flash • medium$/);
	assert.match(line, /100\.0%\/1\.0M/);
	assert.match(line, /↑1\.8k ↓220/);
	assert.match(line, /\$0\.0003/);
});

test("cost is absent until something has been spent", () => {
	assert.equal((footer(state()).render(80)[1] ?? "").includes("$"), false);
});

test("a nearly full context is yellow, and a full one is red", () => {
	// The label reports what is left, so the alarm is a small number.
	const styled = (run: RunState) =>
		new Footer({ state: run, style: createStyler(true), home: "/home/dev" }).render(80)[1] ?? "";
	assert.match(styled(state({ contextTokens: 950_000 })), /\u001b\[31m/);
	assert.match(styled(state({ contextTokens: 950_000 })), /5\.0%\/1\.0M/);
	assert.match(styled(state({ contextTokens: 750_000 })), /\u001b\[33m/);
	assert.equal(/\u001b\[31m/.test(styled(state({ contextTokens: 0 }))), false);
});

test("no line is wider than the terminal, however narrow", () => {
	const crowded = state({
		inputTokens: 323_000,
		outputTokens: 678_000,
		cacheRead: 323_000,
		reasoningTokens: 364_000,
		costUSD: 3.097,
		contextTokens: 950_000,
	});
	for (const width of [12, 20, 40, 80, 120]) {
		for (const line of footer(crowded, "a-very-long-branch-name").render(width)) {
			assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
		}
	}
});
