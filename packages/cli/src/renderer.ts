import type { AgentEvent } from "@earendil-works/pi-agent-core";

export interface RenderState {
	/** First fatal reason seen, if any. Drives the exit code. */
	error?: string;
	wroteText: boolean;
}

export interface Renderer {
	state: RenderState;
	handle: (event: AgentEvent) => void;
}

/** Minimal sink, so the renderer can be driven by a test stream. */
export interface RenderSink {
	write(chunk: string): unknown;
}

/**
 * The only place the CLI knows how to draw an event.
 *
 * A failed turn is recorded, not swallowed. The agent reports a provider or
 * stream failure as an assistant message with `stopReason: "error"` and no
 * content, so a renderer that only prints text deltas exits zero after printing
 * nothing.
 */
export function createRenderer(stream: RenderSink): Renderer {
	const state: RenderState = { wroteText: false };

	const fail = (reason: string): void => {
		state.error ??= reason;
	};

	const handle = (event: AgentEvent): void => {
		switch (event.type) {
			case "message_update":
				if (event.assistantMessageEvent.type === "text_delta") {
					state.wroteText = true;
					stream.write(event.assistantMessageEvent.delta);
				}
				break;
			case "message_end": {
				const message = event.message;
				if (message.role !== "assistant") {
					break;
				}
				if (message.stopReason === "error" || message.stopReason === "aborted") {
					fail(message.errorMessage ?? `the turn ended with stop reason "${message.stopReason}"`);
				}
				break;
			}
			case "tool_execution_start":
				stream.write(`\n[${event.toolName}] ${summarizeArgs(event.args)}\n`);
				break;
			case "tool_execution_end":
				if (event.isError) {
					fail(`tool ${event.toolName} failed`);
				}
				stream.write(`[${event.toolName}] ${event.isError ? "failed" : "done"}\n`);
				break;
			case "turn_end":
				stream.write("\n");
				break;
			default:
				break;
		}
	};

	return { state, handle };
}

/** One-line summary of a tool call, using whichever known argument is present. */
export function summarizeArgs(args: unknown): string {
	if (typeof args !== "object" || args === null) {
		return "";
	}
	const record = args as Record<string, unknown>;
	const key = ["command", "path", "oldText"].find((name) => typeof record[name] === "string");
	if (key === undefined) {
		return "";
	}
	const value = String(record[key]);
	return value.length > 100 ? `${value.slice(0, 100)}...` : value;
}
