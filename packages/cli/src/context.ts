import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * Characters per token, the rule the scripted provider also uses.
 *
 * An estimate is a claim, so the label says so and the preferred path below
 * avoids needing one.
 */
const CHARS_PER_TOKEN = 4;

function contentChars(message: AgentMessage): number {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") {
		return content.length;
	}
	if (Array.isArray(content)) {
		let chars = 0;
		for (const block of content) {
			if (typeof block !== "object" || block === null) {
				continue;
			}
			const record = block as Record<string, unknown>;
			for (const key of ["text", "thinking", "content"]) {
				if (typeof record[key] === "string") {
					chars += (record[key] as string).length;
				}
			}
			// Tool call arguments are model-visible and are not in any text field.
			if (record["arguments"] !== undefined) {
				chars += JSON.stringify(record["arguments"]).length;
			}
		}
		return chars;
	}
	return 0;
}

function estimate(messages: readonly AgentMessage[]): number {
	let chars = 0;
	for (const message of messages) {
		chars += contentChars(message);
	}
	return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Tokens currently occupying the context.
 *
 * Prefers the provider's own count. The most recent assistant message carries
 * the usage for the request that produced it, which *is* the prompt size at
 * that moment — measured rather than estimated. Only the messages after it need
 * the estimate.
 *
 * Written here rather than imported because `pi-agent-core@1.0.2` does not
 * publish the helpers an earlier version had. Its `dist` contains `agent`,
 * `agent-loop`, `proxy`, `stream-fn`, and `types`, and nothing about compaction
 * or context accounting.
 */
export function contextTokens(messages: readonly AgentMessage[]): number {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message === undefined || message.role !== "assistant") {
			continue;
		}
		const usage = (message as { usage?: { totalTokens?: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }).usage;
		if (usage === undefined) {
			continue;
		}
		const reported = usage.totalTokens ?? (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
		if (reported <= 0) {
			continue;
		}
		return reported + estimate(messages.slice(index + 1));
	}
	return estimate(messages);
}
