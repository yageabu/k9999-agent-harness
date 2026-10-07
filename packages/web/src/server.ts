import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Conversation, Harness } from "@earendil-works/pi-durable";
import { PAGE } from "./page.ts";

/**
 * The browser surface (SPEC 0009).
 *
 * The shape of this file follows one rule from the spec: the browser is another
 * reader of committed state, not a second implementation of the session. Every
 * frame it receives came from `watch()`, and every write it sends is a
 * submission the harness may queue, reject, or refuse.
 *
 * A local port that accepts a prompt and runs `bash` is remote code execution
 * with a form in front of it. The four defenses below are the spec's, and each
 * has a test: bind loopback, no CORS, require a token, and check `Origin` on
 * every write.
 */

export interface WebServerOptions {
	harness: Harness;
	conversation: Conversation;
	/** Minted at startup and printed as part of the URL. */
	token: string;
	/** Serving prompts is opt-in, so the dangerous mode must be asked for. */
	allowWrites?: boolean;
	port?: number;
}

export interface WebServer {
	readonly url: string;
	readonly port: number;
	close(): Promise<void>;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function send(response: ServerResponse, status: number, body: string, headers: Record<string, string> = JSON_HEADERS): void {
	response.writeHead(status, headers);
	response.end(body);
}

/** The token travels in the path so a page in another tab cannot guess it from a search. */
function tokenFrom(request: IncomingMessage, url: URL): string | undefined {
	const header = request.headers["x-k9999-token"];
	if (typeof header === "string") {
		return header;
	}
	return url.searchParams.get("t") ?? undefined;
}

/**
 * A browser sends `Origin` on every cross-origin write, and a page in another
 * tab is the attacker this defends against. Requests with no `Origin` at all
 * come from tools like curl, which are not a confused deputy and are held to
 * the token instead.
 */
function originAllowed(request: IncomingMessage, port: number): boolean {
	const origin = request.headers.origin;
	if (origin === undefined) {
		return true;
	}
	return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(chunk as Buffer);
		if (chunks.reduce((n, c) => n + c.length, 0) > 64 * 1024) {
			throw new Error("Body too large");
		}
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.trim() === "") {
		return {};
	}
	const parsed: unknown = JSON.parse(text);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("Body must be a JSON object");
	}
	return parsed as Record<string, unknown>;
}

export async function createWebServer(options: WebServerOptions): Promise<WebServer> {
	const { harness, conversation, token } = options;
	const allowWrites = options.allowWrites ?? false;
	const server: Server = createServer();

	const state = async (): Promise<string> => {
		const view = await conversation.viewState(BACKGROUND_CONTEXT);
		try {
			return JSON.stringify(view.value);
		} finally {
			view.dispose();
		}
	};

	server.on("request", (request, response) => {
		void handle(request, response);
	});

	async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const port = (server.address() as AddressInfo | null)?.port ?? 0;
		const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

		if (request.method === "OPTIONS") {
			// No CORS headers on purpose: a preflight from another origin succeeds
			// at nothing, because there is no Access-Control-Allow-Origin to grant.
			send(response, 204, "", {});
			return;
		}

		if (tokenFrom(request, url) !== token) {
			send(response, 401, JSON.stringify({ error: "Missing or invalid token" }));
			return;
		}

		if (request.method === "GET" && url.pathname === "/") {
			send(response, 200, PAGE, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
			return;
		}

		if (request.method === "GET" && url.pathname === "/state") {
			send(response, 200, await state());
			return;
		}

		if (request.method === "GET" && url.pathname === "/events") {
			response.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-store",
				connection: "keep-alive",
				"x-accel-buffering": "no",
			});
			const frame = (value: unknown): void => {
				response.write(`data: ${JSON.stringify(value)}\n\n`);
			};

			// The state at attachment, which is what a late or reconnecting client
			// needs. Nothing is replayed, because pi-durable does not replay.
			frame({ type: "snapshot", value: JSON.parse(await state()) });

			const watch = await conversation.watch(BACKGROUND_CONTEXT);
			// A whole view per commit rather than the operations between them. The view is
			// bounded — the active transcript and five documents — and pi-durable already
			// collapses to a whole-view frame under back-pressure, so the frame shape is a
			// supported one. Applying operations instead would mean shipping chord's delta
			// format to the browser, which is a second implementation of the thing that has
			// one, and SPEC 0009 rules that out.
			watch.start(async (value) => {
				frame({ type: "snapshot", value });
			});

			request.on("close", () => {
				// Disconnecting a reader must never stop the work. `stop()` ends the
				// watch, not the run; `abort()` is the only thing that ends a run, and
				// nothing here calls it.
				void watch.stop();
			});
			return;
		}

		if (request.method !== "POST") {
			send(response, 404, JSON.stringify({ error: "Not found" }));
			return;
		}

		if (!allowWrites) {
			send(response, 403, JSON.stringify({ error: "This server is read-only. Start it with writes enabled." }));
			return;
		}

		if (!originAllowed(request, port)) {
			send(response, 403, JSON.stringify({ error: "Origin not allowed" }));
			return;
		}

		let body: Record<string, unknown>;
		try {
			body = await readBody(request);
		} catch (error) {
			send(response, 400, JSON.stringify({ error: (error as Error).message }));
			return;
		}

		try {
			if (url.pathname === "/prompt" || url.pathname === "/steer") {
				const content = body.content;
				if (typeof content !== "string" || content.trim() === "") {
					send(response, 400, JSON.stringify({ error: "content must be a non-empty string" }));
					return;
				}
				const requestId = typeof body.requestId === "string" ? body.requestId : undefined;
				const whenBusy = url.pathname === "/steer" ? "steer" : "followUp";
				// `steer` against an idle conversation is refused rather than quietly
				// becoming a follow-up, because a UI that silently changes what you
				// asked for is the behavior that makes people stop trusting it.
				const submission = await conversation.submit(
					requestId === undefined ? { type: "input", content, whenBusy } : { type: "input", content, whenBusy, requestId },
					BACKGROUND_CONTEXT,
				);
				send(response, 202, JSON.stringify({ id: submission.id }));
				return;
			}

			if (url.pathname === "/abort") {
				await conversation.abort(BACKGROUND_CONTEXT);
				send(response, 202, JSON.stringify({ ok: true }));
				return;
			}
		} catch (error) {
			const name = (error as Error).name;
			if (name === "ConversationBusy") {
				send(response, 409, JSON.stringify({ error: "Conversation is busy", code: "busy" }));
				return;
			}
			send(response, 500, JSON.stringify({ error: (error as Error).message }));
			return;
		}

		send(response, 404, JSON.stringify({ error: "Not found" }));
	}

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		// Loopback only. Not a flag, not a default that can be relaxed: serving this
		// on a network interface turns a convenience into an open door.
		server.listen(options.port ?? 0, "127.0.0.1", resolve);
	});

	const bound = server.address() as AddressInfo;
	return {
		port: bound.port,
		url: `http://127.0.0.1:${bound.port}/?t=${token}`,
		close: async () => {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
