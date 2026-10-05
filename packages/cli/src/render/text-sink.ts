import type { FileChange } from "@k9999/core";
import {
	compactNumber,
	type ColorMode,
	createStyler,
	formatCost,
	formatDuration,
	resolveColor,
	shorten,
} from "./format.ts";
import type { RenderItem, RenderSink, RunState } from "./vocabulary.ts";

/** Longest diff line printed before it is clipped. Terminals wrap; a gutter plus wrap reads badly. */
const MAX_DIFF_LINE = 200;

export interface TextSinkOptions {
	/** Where activity goes: tool calls, diffs, turn lines. Defaults to `process.stdout`. */
	readonly write?: (chunk: string) => void;
	/**
	 * Where the model's text goes. Defaults to the activity stream.
	 *
	 * Print mode points this at stdout and activity at stderr, so
	 * `k9999 --print "..." > out.txt` leaves the answer in the file and the
	 * progress on the terminal.
	 */
	readonly writeText?: (chunk: string) => void;
	/** Defaults to `auto`, which is off when the stream is not a TTY or `NO_COLOR` is set. */
	readonly color?: ColorMode;
	/** Used only to resolve `auto`. Defaults to `process.stdout`. */
	readonly stream?: { isTTY?: boolean };
	/** Diff lines printed before truncating. */
	readonly maxDiffLines?: number;
	/** A banner printed once when the sink is created. */
	readonly header?: string;
	/**
	 * Working directory, used to shorten paths for display.
	 *
	 * Tools report absolute paths because that is the fact; a terminal wants the
	 * short form. The sink shortens, and never rewrites what a tool reported.
	 */
	readonly cwd?: string;
}

interface Writer {
	/** Activity: tool calls, diffs, turn lines. */
	write(text: string): void;
	/** The model's text, which may go to a different stream in print mode. */
	writeText(text: string): void;
	/** Newline unless the cursor is already at the start of a line. */
	breakLine(): void;
}

/**
 * One logical cursor across two streams.
 *
 * Print mode sends the answer to stdout and activity to stderr, so a newline
 * has to follow whichever stream was written to last. Writing it to a fixed
 * stream would put a blank line in the wrong file and leave the answer without
 * a trailing newline.
 */
function createWriter(activity: (chunk: string) => void, answer: (chunk: string) => void): Writer {
	let atLineStart = true;
	let last: (chunk: string) => void = activity;

	const track = (text: string, target: (chunk: string) => void): void => {
		if (text === "") {
			return;
		}
		target(text);
		last = target;
		atLineStart = text.endsWith("\n");
	};

	return {
		write: (text) => track(text, activity),
		writeText: (text) => track(text, answer),
		breakLine(): void {
			if (!atLineStart) {
				last("\n");
				atLineStart = true;
			}
		},
	};
}

function clip(text: string): string {
	return text.length > MAX_DIFF_LINE ? `${text.slice(0, MAX_DIFF_LINE - 1)}…` : text;
}

/**
 * The terminal sink.
 *
 * Colour comes from `node:util`'s `styleText`, which emits nothing when the
 * stream is not a TTY, so a piped run stays plain text without any branch here.
 * The diff comes from the tool's own `removed` and `added` lines: an exact
 * string replacement already knows both sides, so nothing is computed.
 */
export function createTextSink(options: TextSinkOptions = {}): RenderSink {
	const activity = options.write ?? ((chunk: string) => void process.stdout.write(chunk));
	const out = options.writeText ?? activity;
	const color = resolveColor(options.color ?? "auto", options.stream ?? process.stdout);
	const s = createStyler(color);
	const writer = createWriter(activity, out);
	const maxDiffLines = options.maxDiffLines ?? 24;
	const cwd = options.cwd;

	// Which kind of inline content is currently open, so a switch between them
	// can close the previous one without ending a sentence mid-stream.
	let inline: "none" | "text" | "thinking" = "none";

	const dim = s("dim");
	const cyan = s("cyan");
	const green = s("green");
	const red = s("red");
	const yellow = s("yellow");
	const bold = s("bold");

	function closeInline(next: "none" | "text" | "thinking"): void {
		if (inline !== "none" && inline !== next) {
			// `breakLine` rather than a bare newline: text that already ended its line
			// must not gain a blank one, or every tool call after a paragraph would
			// open a gap.
			writer.breakLine();
		}
		inline = next;
	}

	function renderChange(change: FileChange): void {
		const shown = change.removed.length + change.added.length;
		const budget = Math.max(2, maxDiffLines);
		const keepRemoved = Math.min(change.removed.length, Math.ceil(budget / 2));
		const keepAdded = Math.min(change.added.length, budget - keepRemoved);

		writer.write(`${dim("  │")} ${dim(`${shorten(change.path, cwd)}:${change.line}`)}\n`);
		for (const line of change.removed.slice(0, keepRemoved)) {
			writer.write(`${dim("  │")} ${red(`- ${clip(line)}`)}\n`);
		}
		for (const line of change.added.slice(0, keepAdded)) {
			writer.write(`${dim("  │")} ${green(`+ ${clip(line)}`)}\n`);
		}
		const hidden = shown - Math.min(keepRemoved, change.removed.length) - Math.min(keepAdded, change.added.length);
		if (hidden > 0) {
			writer.write(`${dim(`  │ … ${hidden} more line(s)`)}\n`);
		}
	}

	function renderTurn(state: RunState): void {
		const parts = [
			`turn ${state.turns}`,
			`${compactNumber(state.inputTokens)} in`,
			`${compactNumber(state.outputTokens)} out`,
		];
		if (state.toolCalls > 0) {
			parts.push(`${state.toolCalls} tool${state.toolCalls === 1 ? "" : "s"}`);
		}
		if (state.costUSD > 0) {
			parts.push(formatCost(state.costUSD));
		}
		writer.write(`${dim(`  · ${parts.join(" · ")}`)}\n`);
	}

	const sink: RenderSink = {
		name: "text",

		emit(item: RenderItem): void {
			switch (item.kind) {
				case "text": {
					closeInline("text");
					writer.writeText(item.text);
					break;
				}
				case "thinking": {
					closeInline("thinking");
					writer.write(dim(item.text));
					break;
				}
				case "toolCall": {
					closeInline("none");
					writer.breakLine();
					writer.write(`${cyan("→")} ${bold(item.name)}${item.summary === "" ? "" : `  ${item.summary}`}\n`);
					break;
				}
				case "toolResult": {
					closeInline("none");
					const mark = item.ok ? green("✓") : red("✗");
					writer.write(`  ${mark} ${item.summary}\n`);
					if (item.change) {
						renderChange(item.change);
					}
					break;
				}
				case "turn": {
					closeInline("none");
					writer.breakLine();
					renderTurn(item.state);
					break;
				}
				case "error": {
					closeInline("none");
					writer.breakLine();
					writer.write(`${red("error")} ${item.message}\n`);
					break;
				}
				case "interaction": {
					closeInline("none");
					writer.breakLine();
					writer.write(`${yellow("?")} ${item.prompt}\n`);
					writer.write(`${dim(`  answer by ${item.deadline}, default "${item.defaultAction}"`)}\n`);
					break;
				}
				case "degrade": {
					closeInline("none");
					writer.breakLine();
					writer.write(`${yellow("degraded")} ${item.reason}\n`);
					break;
				}
				case "check": {
					closeInline("none");
					writer.breakLine();
					writer.write(`${item.ok ? green("check ok") : red("check failed")} ${item.detail}\n`);
					break;
				}
			}
		},

		end(state: RunState): void {
			closeInline("none");
			writer.breakLine();
			const wall = Date.now() - state.startedAt;
			const parts = [
				`${state.turns} turn${state.turns === 1 ? "" : "s"}`,
				`${state.toolCalls} tool call${state.toolCalls === 1 ? "" : "s"}`,
				`${compactNumber(state.inputTokens)} in / ${compactNumber(state.outputTokens)} out`,
			];
			if (state.costUSD > 0) {
				parts.push(formatCost(state.costUSD));
			}
			parts.push(formatDuration(wall));
			writer.write(`${dim(`  ${parts.join(" · ")}`)}\n`);
		},
	};

	if (options.header !== undefined) {
		writer.write(`${dim(options.header)}\n\n`);
	}

	return sink;
}
