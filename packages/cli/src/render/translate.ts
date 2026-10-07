import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { FileChange } from "@k9999/core";
import { shorten } from "./format.ts";
import { initialRunState, type RenderItem, type RunState } from "./vocabulary.ts";

/** One line, no newlines, bounded length: a summary is a label, not a payload. */
function oneLine(text: string, limit = 100): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	return collapsed.length > limit ? `${collapsed.slice(0, limit - 1)}…` : collapsed;
}

function firstLine(text: string): string {
	return text.split("\n")[0]?.trim() ?? "";
}

/** Text content of a tool result, which is what the tool chose to tell the model. */
function resultText(result: unknown): string {
	if (typeof result !== "object" || result === null) {
		return "";
	}
	const content = (result as { content?: unknown }).content;
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((block) => {
			if (typeof block === "object" && block !== null && (block as { type?: string }).type === "text") {
				return String((block as { text?: unknown }).text ?? "");
			}
			return "";
		})
		.join("");
}

/**
 * The change an edit reports, when the result carries one.
 *
 * Shape-checked rather than trusted: the details type belongs to the tool, and
 * a sink must not throw because some other tool returned a similar-looking object.
 */
function changeOf(result: unknown): FileChange | undefined {
	if (typeof result !== "object" || result === null) {
		return undefined;
	}
	const details = (result as { details?: unknown }).details;
	if (typeof details !== "object" || details === null) {
		return undefined;
	}
	const change = (details as { change?: unknown }).change;
	if (typeof change !== "object" || change === null) {
		return undefined;
	}
	const candidate = change as Partial<FileChange>;
	if (
		typeof candidate.path !== "string" ||
		typeof candidate.line !== "number" ||
		!Array.isArray(candidate.removed) ||
		!Array.isArray(candidate.added)
	) {
		return undefined;
	}
	return {
		path: candidate.path,
		line: candidate.line,
		removed: candidate.removed.map(String),
		added: candidate.added.map(String),
	};
}

/** A one-line description of a tool call, using whichever argument identifies it. */
export function summarizeCall(name: string, args: unknown): string {
	if (typeof args !== "object" || args === null) {
		return "";
	}
	const record = args as Record<string, unknown>;
	if (name === "bash" || name === "pwsh") {
		return oneLine(String(record["command"] ?? ""));
	}
	if (typeof record["path"] === "string") {
		return oneLine(record["path"] as string);
	}
	const first = Object.values(record).find((value) => typeof value === "string");
	return typeof first === "string" ? oneLine(first) : "";
}

/** A one-line description of what a tool produced, for a reader rather than a model. */
export function summarizeResult(
	name: string,
	result: unknown,
	isError: boolean,
	cwd: string | undefined,
): string {
	const text = resultText(result);
	if (isError) {
		return oneLine(firstLine(text).replace(/^\[[^\]]*\]\s*/, "") || "failed");
	}
	if (name === "edit") {
		const change = changeOf(result);
		if (change) {
			return `${shorten(change.path, cwd)}  +${change.added.length} -${change.removed.length}`;
		}
	}
	if (name === "read") {
		// The first line is the resolved path and the rest is numbered file content.
		const lines = text.split("\n");
		return `${oneLine(shorten(lines[0] ?? "", cwd))}  ${Math.max(0, lines.length - 1)} lines`;
	}
	if (name === "bash" || name === "pwsh") {
		return oneLine(firstLine(text));
	}
	return oneLine(firstLine(text) || "done");
}

export interface TranslatorDeps {
	/**
	 * Tokens currently in the context.
	 *
	 * A callback rather than a value because it is a property of the whole
	 * session and the render layer has no view of the session. The command line
	 * owns the agent and answers this.
	 */
	readonly contextTokens?: () => number;
}

/**
 * What the render layer listens to, in K9999's own words.
 *
 * This is the seam that made the harness change survivable. The translator used
 * to read `pi-agent-core`'s event objects directly, which meant every surface
 * built on it inherited that library's shape — and when the harness underneath
 * moved to `pi-durable` (ADR-0017) the events kept their names and changed their
 * payloads. Two adapters below turn either vocabulary into this one, and nothing
 * past this point can tell which harness is running.
 */
export type SourceEvent =
	| { readonly type: "text"; readonly text: string }
	| { readonly type: "thinking"; readonly text: string }
	| { readonly type: "messageEnd"; readonly message: AssistantMessageShape }
	| { readonly type: "toolStart"; readonly id: string; readonly name: string; readonly args: unknown }
	| {
			readonly type: "toolEnd";
			readonly id: string;
			readonly name: string;
			readonly ok: boolean;
			readonly result: unknown;
	  }
	| { readonly type: "turnEnd" };

/** The parts of an assistant message this layer reads, and nothing else. */
export interface AssistantMessageShape {
	readonly role?: string;
	readonly stopReason?: string;
	readonly errorMessage?: string;
	readonly usage?: {
		readonly input: number;
		readonly output: number;
		readonly cacheRead: number;
		readonly cacheWrite: number;
		readonly reasoning?: number;
		readonly cost: { readonly total: number };
	};
}

export interface Translator {
	readonly state: RunState;
	translate(event: SourceEvent): RenderItem[];
}

/**
 * Agent events in, render items out.
 *
 * Kept separate from any sink because the translation is the same whichever
 * surface consumes it, and because a recorder makes it testable without a
 * terminal.
 */
export function createTranslator(initial: RunState, deps: TranslatorDeps = {}): Translator {
	let state = initial;

	return {
		get state(): RunState {
			return state;
		},

		translate(event: SourceEvent): RenderItem[] {
			const items: RenderItem[] = [];

			switch (event.type) {
				case "text": {
					if (event.text !== "") {
						items.push({ kind: "text", text: event.text });
					}
					break;
				}

				case "thinking": {
					if (event.text !== "") {
						items.push({ kind: "thinking", text: event.text });
					}
					break;
				}

				case "messageEnd": {
					const message = event.message;
					if (message.role !== undefined && message.role !== "assistant") {
						break;
					}
					// A provider or stream failure arrives as an assistant message with
					// an error stop reason and no content. A sink that only prints text
					// deltas would print nothing and report success.
					if (message.stopReason === "error" || message.stopReason === "aborted") {
						items.push({
							kind: "error",
							message: message.errorMessage ?? `the turn ended with stop reason "${message.stopReason}"`,
						});
						break;
					}
					const usage = message.usage;
					if (usage) {
						state = {
							...state,
							inputTokens: state.inputTokens + usage.input + usage.cacheRead + usage.cacheWrite,
							outputTokens: state.outputTokens + usage.output,
							cacheRead: state.cacheRead + usage.cacheRead,
							cacheWrite: state.cacheWrite + usage.cacheWrite,
							reasoningTokens: state.reasoningTokens + (usage.reasoning ?? 0),
							costUSD: state.costUSD + usage.cost.total,
						};
					}
					break;
				}

				case "toolStart": {
					items.push({
						kind: "toolCall",
						id: event.id,
						name: event.name,
						summary: summarizeCall(event.name, event.args),
					});
					break;
				}

				case "toolEnd": {
					state = { ...state, toolCalls: state.toolCalls + 1 };
					const change = changeOf(event.result);
					items.push({
						kind: "toolResult",
						id: event.id,
						name: event.name,
						ok: event.ok,
						summary: summarizeResult(event.name, event.result, !event.ok, state.cwd),
						...(change === undefined ? {} : { change }),
					});
					break;
				}

				case "turnEnd": {
					state = {
						...state,
						turns: state.turns + 1,
						...(deps.contextTokens === undefined ? {} : { contextTokens: deps.contextTokens() }),
					};
					items.push({ kind: "turn", state });
					break;
				}
			}

			return items;
		},
	};
}

export { initialRunState };
