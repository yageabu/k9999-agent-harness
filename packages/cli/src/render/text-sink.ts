import {
	createStyler,
	errorLines,
	lineStyle,
	summaryLine,
	toolCallLines,
	toolResultLines,
	turnLine,
} from "./layout.ts";
import { type ColorMode, resolveColor } from "./format.ts";
import type { RenderItem, RenderSink, RunState } from "./vocabulary.ts";

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
	/** Working directory, used to shorten paths for display. */
	readonly cwd?: string;
}

interface Writer {
	write(text: string): void;
	writeText(text: string): void;
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

/**
 * The terminal sink: streamed, incremental, one item at a time.
 *
 * Line formatting lives in `layout.ts` so the TUI produces the same transcript.
 * What is here is the part a stream needs and a component does not: a cursor,
 * and the ability to write a text delta the moment it arrives.
 */
export function createTextSink(options: TextSinkOptions = {}): RenderSink {
	const activity = options.write ?? ((chunk: string) => void process.stdout.write(chunk));
	const answer = options.writeText ?? activity;
	const color = resolveColor(options.color ?? "auto", options.stream ?? process.stdout);
	const style = lineStyle(createStyler(color), options.cwd, options.maxDiffLines);
	const writer = createWriter(activity, answer);

	// Which kind of inline content is open, so a switch between them can close
	// the previous one without ending a sentence mid-stream.
	let inline: "none" | "text" | "thinking" = "none";

	function closeInline(next: "none" | "text" | "thinking"): void {
		if (inline !== "none" && inline !== next) {
			// `breakLine` rather than a bare newline: text that already ended its
			// line must not gain a blank one.
			writer.breakLine();
		}
		inline = next;
	}

	function block(lines: readonly string[]): void {
		closeInline("none");
		writer.breakLine();
		for (const line of lines) {
			writer.write(`${line}\n`);
		}
	}

	const sink: RenderSink = {
		name: "text",

		emit(item: RenderItem): void {
			switch (item.kind) {
				case "text":
					closeInline("text");
					writer.writeText(item.text);
					break;
				case "thinking":
					closeInline("thinking");
					writer.write(style.style("dim")(item.text));
					break;
				case "toolCall":
					block(toolCallLines(item.name, item.summary, style));
					break;
				case "toolResult":
					block(toolResultLines(item.ok, item.summary, item.change, style));
					break;
				case "turn":
					block([turnLine(item.state, style)]);
					break;
				case "error":
					block(errorLines(item.message, style));
					break;
				case "interaction":
					block([
						`${style.style("yellow")("?")} ${item.prompt}`,
						style.style("dim")(`  answer by ${item.deadline}, default "${item.defaultAction}"`),
					]);
					break;
				case "degrade":
					block([`${style.style("yellow")("degraded")} ${item.reason}`]);
					break;
				case "check":
					block([
						`${item.ok ? style.style("green")("check ok") : style.style("red")("check failed")} ${item.detail}`,
					]);
					break;
			}
		},

		end(state: RunState): void {
			block([summaryLine(state, style)]);
		},
	};

	if (options.header !== undefined) {
		writer.write(`${style.style("dim")(options.header)}\n\n`);
	}

	return sink;
}
