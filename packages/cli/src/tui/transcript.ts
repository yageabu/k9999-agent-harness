import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	errorLines,
	type LineStyle,
	summaryLine,
	toolCallLines,
	toolResultLines,
	turnLine,
} from "../render/layout.ts";
import type { RenderItem, RunState } from "../render/vocabulary.ts";

/**
 * One thing the agent did.
 *
 * `text` and `thinking` accumulate: a streamed reply arrives as many deltas and
 * is one paragraph in the transcript. `block` is already-formatted lines whose
 * content is complete on arrival.
 */
type Entry =
	| { kind: "text"; text: string }
	| { kind: "thinking"; text: string }
	| { kind: "block"; lines: string[] };

export interface TranscriptOptions {
	readonly style: LineStyle;
	/**
	 * How many lines may be shown.
	 *
	 * A VStack does not allocate height, so a child has to fit itself. Reading
	 * the terminal is therefore the transcript's job rather than the layout's.
	 */
	readonly budget: () => number;
	/** Entries kept before the oldest are dropped. Bounds memory in a long session. */
	readonly maxEntries?: number;
	/**
	 * Rendered above every entry, and scrolled away with them.
	 *
	 * The startup block goes here rather than in a fixed panel: it is worth
	 * five lines once, and five lines forever is a different thing.
	 */
	readonly leading?: Component;
	/** Called when a turn arrives, so a status header can follow the totals. */
	readonly onTurn?: (state: RunState) => void;
}

/**
 * The transcript, as a component.
 *
 * It returns the *last* `budget()` lines. `VStack` slices children from the
 * start, so a transcript that returned its whole history would show the oldest
 * lines and hide the newest — the opposite of what a transcript is for.
 */
export class TranscriptView implements Component {
	private entries: Entry[] = [];
	private readonly style: LineStyle;
	private readonly budget: () => number;
	private readonly maxEntries: number;
	private readonly leading: Component | undefined;
	private readonly onTurn: ((state: RunState) => void) | undefined;

	constructor(options: TranscriptOptions) {
		this.style = options.style;
		this.budget = options.budget;
		this.maxEntries = options.maxEntries ?? 2000;
		this.leading = options.leading;
		this.onTurn = options.onTurn;
	}

	append(item: RenderItem): void {
		switch (item.kind) {
			case "text":
				this.pushInline("text", item.text);
				break;
			case "thinking":
				this.pushInline("thinking", item.text);
				break;
			case "toolCall":
				this.pushBlock(toolCallLines(item.name, item.summary, this.style));
				break;
			case "toolResult":
				this.pushBlock(toolResultLines(item.ok, item.summary, item.change, this.style));
				break;
			case "turn":
				this.pushBlock([turnLine(item.state, this.style)]);
				this.onTurn?.(item.state);
				break;
			case "error":
				this.pushBlock(errorLines(item.message, this.style));
				break;
			case "interaction":
				this.pushBlock([
					`${this.style.style("yellow")("?")} ${item.prompt}`,
					this.style.style("dim")(`  answer by ${item.deadline}, default "${item.defaultAction}"`),
				]);
				break;
			case "degrade":
				this.pushBlock([`${this.style.style("yellow")("degraded")} ${item.reason}`]);
				break;
			case "check":
				this.pushBlock([
					`${item.ok ? this.style.style("green")("check ok") : this.style.style("red")("check failed")} ${item.detail}`,
				]);
				break;
		}
	}

	/**
	 * Append lines that are already formatted, such as the startup banner.
	 *
	 * A banner is not a `RenderItem`: nothing that happened produced it, and
	 * giving it a variant would put presentation in a vocabulary that exists to
	 * keep presentation out.
	 */
	appendLines(lines: readonly string[]): void {
		this.pushBlock([...lines]);
	}

	end(state: RunState): void {
		this.pushBlock([summaryLine(state, this.style)]);
	}

	private pushInline(kind: "text" | "thinking", delta: string): void {
		const last = this.entries[this.entries.length - 1];
		// A delta continues the previous entry only when it is the same kind. A
		// tool call between two replies is a boundary, and merging across it would
		// put text from before the call after it.
		if (last && (last.kind === "text" || last.kind === "thinking") && last.kind === kind) {
			last.text += delta;
			return;
		}
		this.entries.push({ kind, text: delta });
		this.trim();
	}

	private pushBlock(lines: string[]): void {
		this.entries.push({ kind: "block", lines });
		this.trim();
	}

	private trim(): void {
		if (this.entries.length > this.maxEntries) {
			this.entries.splice(0, this.entries.length - this.maxEntries);
		}
	}

	/** Called by the TUI when the theme changes or a re-render from scratch is needed. */
	invalidate(): void {
		this.leading?.invalidate();
	}

	render(width: number): string[] {
		const usable = Math.max(1, width);
		const lines: string[] = [];

		for (const line of this.leading?.render(usable) ?? []) {
			lines.push(...this.fit(line, usable));
		}

		for (const entry of this.entries) {
			if (entry.kind === "block") {
				for (const line of entry.lines) {
					lines.push(...this.fit(line, usable));
				}
				continue;
			}
			const styled = entry.kind === "thinking" ? entry.text.split("\n").map((l) => this.style.style("dim")(l)) : entry.text.split("\n");
			for (const line of styled) {
				for (const wrapped of wrapTextWithAnsi(line, usable)) {
					lines.push(...this.fit(wrapped, usable));
				}
			}
		}

		const budget = Math.max(1, this.budget());
		return lines.length > budget ? lines.slice(lines.length - budget) : lines;
	}

	/** Every line must be exactly `width` visible columns wide, ANSI included. */
	private fit(line: string, width: number): string[] {
		if (visibleWidth(line) <= width) {
			const pad = width - visibleWidth(line);
			return [pad > 0 ? line + " ".repeat(pad) : line];
		}
		// Hard split on visible columns rather than a truncation with an ellipsis:
		// a diff line cut in the middle is more useful than one cut short, and the
		// wrap above has already handled the ordinary case.
		const out: string[] = [];
		let rest = line;
		while (visibleWidth(rest) > width) {
			let cut = 0;
			let columns = 0;
			for (const char of rest) {
				const charWidth = visibleWidth(char);
				if (columns + charWidth > width) {
					break;
				}
				columns += charWidth;
				cut += char.length;
			}
			out.push(rest.slice(0, cut));
			rest = rest.slice(cut);
		}
		const pad = width - visibleWidth(rest);
		out.push(pad > 0 ? rest + " ".repeat(pad) : rest);
		return out;
	}
}
