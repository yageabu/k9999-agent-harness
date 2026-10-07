import { createHash } from "node:crypto";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import {
	defineExtension,
	GenerationTask,
	hook,
	type Conversation,
	type Extension,
} from "@earendil-works/pi-durable";

/**
 * The request inspector, in process (SPEC 0009, tier C).
 *
 * ccglass shows this by sitting outside the client as a base-URL proxy, which is
 * what it has to do because it is not the client. K9999 is the client, so the
 * `GenerationTask` hooks hand over the same thing with no proxy, no certificate,
 * and no configurable endpoint.
 *
 * **What this can see, and what it cannot.**
 *
 * It sees the messages going to the provider and the tool schemas offered with
 * them. It does **not** see the bytes: `pi-ai` serializes after this point. A page
 * built on this must say so, because the alternative is a person debugging a
 * serialization problem with a view that cannot show one.
 *
 * **It is not durable, deliberately.** `HookApi` extends `DocumentReader` and the
 * hook has no commit, which turns out to be the right answer rather than a
 * limitation to work around: a request inspector is a live debugging view, and
 * committing every request body would put large blobs in the session store and
 * create a second source of truth for numbers `pi.usage` already records.
 * The page labels it as this process, lost on restart.
 */

export interface WireTool {
	readonly name: string;
	readonly description: string;
	/** The JSON schema, as sent. */
	readonly parameters: unknown;
}

export interface WireRequest {
	readonly at: string;
	/** 1 for the first attempt; higher when a retry followed. */
	readonly attempt: number;
	readonly systemDigest: string;
	readonly toolsDigest: string;
	readonly messages: readonly { readonly role: string; readonly bytes: number }[];
	readonly response?: {
		readonly input: number;
		readonly output: number;
		readonly cacheRead: number;
		readonly cacheWrite: number;
		readonly total: number;
		readonly cost: number;
		readonly stopReason: string;
		readonly textBytes: number;
	};
}

export interface WireState {
	/** The system prompt of the newest request, when the provider receives one as a message. */
	readonly system: string;
	/** Whether a system prompt was seen at all. A profile may deliver one as sections. */
	readonly hasSystem: boolean;
	/** Where `system` came from, because the two sources are not the same thing. */
	readonly systemSource: "message" | "sections" | "none";
	/** Tool schemas of the newest request, in full. */
	readonly tools: readonly WireTool[];
	/** Newest last. */
	readonly requests: readonly WireRequest[];
	/** What this view cannot show, so the page can say it rather than imply otherwise. */
	readonly boundary: string;
}

const MESSAGE_LIMIT = 20;

/**
 * A stable short digest of a value, so the page can show *that* the prompt or the
 * tool list changed without shipping either one twice.
 */
function digest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 12);
}

function bytesOf(message: Message): number {
	const content = message.content as unknown;
	if (typeof content === "string") {
		return content.length;
	}
	return JSON.stringify(content ?? "").length;
}

function toolsFrom(messages: readonly Message[]): WireTool[] {
	// The tool set rides on the system message rather than as its own field —
	// measured, not assumed: `request` has exactly one key, `messages`.
	const system = messages.find((message) => message.role === "system");
	const added = (system as { toolsAdded?: unknown } | undefined)?.toolsAdded;
	if (!Array.isArray(added)) {
		return [];
	}
	return added.map((tool: { name?: string; description?: string; parameters?: unknown }) => ({
		name: tool.name ?? "(unnamed)",
		description: tool.description ?? "",
		parameters: tool.parameters ?? {},
	}));
}

export interface WireRecorder {
	readonly extension: Extension;
	/**
	 * Attach the conversation the sections are rendered from.
	 *
	 * A profile's `system.md` is a `PromptSection`, and `pi-durable` delivers it
	 * positionally: the system *message* going to the provider has empty content
	 * and the text is assembled from the sections at request time. So the hook
	 * cannot see it, and the pane would say "no prompt" about a request carrying a
	 * kilo-token one. Measured before this: 238 input tokens without a profile
	 * prompt, 1186 with a 2590-character one — the prompt was plainly being sent
	 * while the pane showed nothing.
	 */
	bind(conversation: Conversation): void;
	snapshot(): Promise<WireState>;
}

export function createWireRecorder(options: { limit?: number } = {}): WireRecorder {
	const limit = options.limit ?? MESSAGE_LIMIT;
	const requests: WireRequest[] = [];
	let system = "";
	let hasSystem = false;
	let bound: Conversation | undefined;
	let tools: WireTool[] = [];
	let pending: { at: string; attempt: number; systemDigest: string; toolsDigest: string; messages: readonly { role: string; bytes: number }[] } | undefined;
	let attempt = 0;

	const extension = defineExtension({
		name: "k9999.wire",
		hooks: [
			hook(GenerationTask, {
				// Runs before every attempt, including a recovery attempt, so a retry
				// is a second record rather than an overwrite of the first.
				beforeRequest: (request) => {
					const requestTools = toolsFrom(request.messages);
					const systemMessage = request.messages.find((message) => message.role === "system");
					const systemContent = typeof systemMessage?.content === "string" ? systemMessage.content : "";
					if (systemContent !== "") {
						system = systemContent;
						hasSystem = true;
					} else if (systemMessage !== undefined) {
						// A system message with empty content is how pi-durable marks a
						// positional prompt change; the text, if any, arrives as sections
						// this hook cannot see. Recorded rather than left to look absent.
						hasSystem = false;
					}
					if (requestTools.length > 0) {
						tools = requestTools;
					}
					attempt += 1;
					pending = {
						at: new Date().toISOString(),
						attempt,
						systemDigest: digest(system),
						toolsDigest: digest(tools.map((tool) => tool.name)),
						messages: request.messages.map((message) => ({ role: String(message.role), bytes: bytesOf(message) })),
					};
					return undefined;
				},

				afterResponse: (message: AssistantMessage) => {
					const usage = message.usage;
					const text = (message.content ?? [])
						.filter((part): part is { type: "text"; text: string } => part.type === "text")
						.map((part) => part.text)
						.join("").length;
					requests.push({
						at: pending?.at ?? new Date().toISOString(),
						attempt: pending?.attempt ?? 1,
						systemDigest: pending?.systemDigest ?? digest(system),
						toolsDigest: pending?.toolsDigest ?? digest([]),
						messages: pending?.messages ?? [],
						response: {
							input: usage?.input ?? 0,
							output: usage?.output ?? 0,
							cacheRead: usage?.cacheRead ?? 0,
							cacheWrite: usage?.cacheWrite ?? 0,
							total: usage?.totalTokens ?? 0,
							cost: usage?.cost?.total ?? 0,
							stopReason: String(message.stopReason ?? ""),
							textBytes: text,
						},
					});
					pending = undefined;
					// Bounded: an inspector that grows without limit is a memory leak with
					// a user interface.
					while (requests.length > limit) {
						requests.shift();
					}
				},
			}),
		],
	});

	return {
		extension,
		bind(conversation: Conversation): void {
			bound = conversation;
		},
		async snapshot(): Promise<WireState> {
			// Prefer the message when there is one, because that is what actually went.
			// Fall back to rendering the sections, which is the same text by a different
			// route, and label which it was.
			let systemSource: WireState["systemSource"] = hasSystem ? "message" : "none";
			let rendered = system;
			if (!hasSystem && bound !== undefined && !rendered) {
				try {
					const agent = await bound.agent(BACKGROUND_CONTEXT);
					const parts: string[] = [];
					for (const section of agent.sections ?? []) {
						const text = await section.render(
							{ conversationId: bound.id, agent, env: undefined, shown: {} } as never,
							BACKGROUND_CONTEXT,
						);
						if (typeof text === "string" && text !== "") {
							parts.push(section.tag === false ? text : `<${section.key}>\n${text}\n</${section.key}>`);
						}
					}
					if (parts.length > 0) {
						rendered = parts.join("\n\n");
						systemSource = "sections";
					}
				} catch {
					// A snapshot must never be the reason a page fails to render.
				}
			}
			return {
				system: rendered,
				hasSystem: systemSource !== "none",
				systemSource,
				tools,
				requests: [...requests],
				boundary:
					"What went to the model as this process intended it. Not the bytes on the wire — pi-ai serializes after this point — and not durable: this is memory, lost on restart.",
			};
		},
	};
}
