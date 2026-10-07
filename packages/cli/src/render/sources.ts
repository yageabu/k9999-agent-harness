import type { AgentEvent as AgentCoreEvent } from "@earendil-works/pi-agent-core";
import type { AgentEvent as DurableEvent } from "@earendil-works/pi-durable";
import type { SourceEvent } from "./translate.ts";

/**
 * The two vocabularies, turned into K9999's own.
 *
 * The harness underneath moved from `pi-agent-core` to `pi-durable` (ADR-0017)
 * and the events kept their names while changing their payloads — which is the
 * worst of both, because a rename is a compile error and a reshaped payload is a
 * runtime one. Both adapters live here so the difference is in one file rather
 * than spread through the renderer, and `translate.ts` reads neither library.
 *
 * `fromDurable` is the one that will be left.
 */

export function fromAgentCore(event: AgentCoreEvent): SourceEvent[] {
	switch (event.type) {
		case "message_update": {
			const update = event.assistantMessageEvent;
			if (update.type === "text_delta") {
				return [{ type: "text", text: update.delta }];
			}
			if (update.type === "thinking_delta") {
				return [{ type: "thinking", text: update.delta }];
			}
			return [];
		}
		case "message_end":
			return [{ type: "messageEnd", message: event.message }];
		case "tool_execution_start":
			return [{ type: "toolStart", id: event.toolCallId, name: event.toolName, args: event.args }];
		case "tool_execution_end":
			return [
				{
					type: "toolEnd",
					id: event.toolCallId,
					name: event.toolName,
					ok: !event.isError,
					result: event.result,
				},
			];
		case "turn_end":
			return [{ type: "turnEnd" }];
		default:
			return [];
	}
}

/** The tool result a durable event carries, in the shape `changeOf` looks through. */
function resultOf(entry: { model?: readonly unknown[]; data?: unknown } | undefined): unknown {
	const message = entry?.model?.[0] as { content?: unknown } | undefined;
	return { content: message?.content, details: entry?.data };
}

export function fromDurable(event: DurableEvent): SourceEvent[] {
	switch (event.type) {
		case "message_update": {
			const out: SourceEvent[] = [];
			for (const change of event.changes) {
				if (change.type === "text_delta") {
					out.push({ type: "text", text: change.delta });
				} else if (change.type === "thinking_delta") {
					out.push({ type: "thinking", text: change.delta });
				}
			}
			return out;
		}
		case "message_end": {
			// The message rides inside the committed entry rather than on the event.
			const message = (event.entry.model ?? [])[0];
			return message === undefined ? [] : [{ type: "messageEnd", message: message as never }];
		}
		case "tool_execution_start":
			return [{ type: "toolStart", id: event.toolCallId, name: event.toolName, args: event.args }];
		case "tool_execution_end": {
			const message = (event.entry?.model ?? [])[0] as { isError?: boolean } | undefined;
			return [
				{
					type: "toolEnd",
					id: event.toolCallId,
					name: event.toolName,
					// An entry is absent when the tool task faulted or was orphaned, which
					// is a failure even though there is no result saying so.
					ok: event.entry !== undefined && message?.isError !== true,
					result: resultOf(event.entry),
				},
			];
		}
		case "turn_end":
			return [{ type: "turnEnd" }];
		default:
			return [];
	}
}
