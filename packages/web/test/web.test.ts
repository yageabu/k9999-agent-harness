import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { Conversation, Harness } from "@earendil-works/pi-durable";
import { createWebServer, PAGE, type WebServer } from "../src/index.ts";

/**
 * SPEC 0009's acceptance criteria, run against a stub conversation.
 *
 * The stub is the point: every criterion here is about the server's boundary —
 * who may read, who may write, and what a disconnect does — and none of it is
 * about the agent. A real Harness would need a credential and a network to test
 * a 401.
 */

interface Recorder {
	submitted: unknown[];
	aborted: number;
	stopped: number;
}

function stub(): { conversation: Conversation; harness: Harness; recorded: Recorder } {
	const recorded: Recorder = { submitted: [], aborted: 0, stopped: 0 };
	const value = {
		conversation: { id: 1 },
		entries: [{ kind: "pi.user", model: [{ role: "user", content: "hello" }] }],
		docs: { "pi.live": {}, "pi.inbox": { items: [] }, "pi.usage": { models: {}, tools: {} } },
	};
	const conversation = {
		id: 1,
		viewState: async () => ({ value, dispose: () => {} }),
		watch: async () => ({
			value,
			start: () => {},
			stop: async () => {
				recorded.stopped++;
			},
			closed: false,
		}),
		submit: async (draft: unknown) => {
			recorded.submitted.push(draft);
			return { id: recorded.submitted.length };
		},
		abort: async () => {
			recorded.aborted++;
		},
	} as unknown as Conversation;
	return { conversation, harness: {} as Harness, recorded };
}

const running: WebServer[] = [];
after(async () => {
	for (const server of running) await server.close();
});

async function start(options: { allowWrites?: boolean; token?: string } = {}): Promise<{
	server: WebServer;
	recorded: Recorder;
	token: string;
}> {
	const { conversation, harness, recorded } = stub();
	const token = options.token ?? "test-token";
	const server = await createWebServer({
		harness,
		conversation,
		token,
		allowWrites: options.allowWrites ?? false,
	});
	running.push(server);
	return { server, recorded, token };
}

/** `server.url` is `http://host:port/?t=...`; strip both the query and the trailing slash. */
const origin = (server: WebServer): string => server.url.split("?")[0]!.replace(/\/$/, "");

const post = (server: WebServer, path: string, token: string, body: unknown, originHeader?: string): Promise<Response> =>
	fetch(`${origin(server)}${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-k9999-token": token,
			...(originHeader === undefined ? {} : { origin: originHeader }),
		},
		body: JSON.stringify(body),
	});

describe("the browser surface", () => {
	it("binds loopback only, so a connection to another interface is not served", async () => {
		const { server } = await start();
		// The URL is what the server printed, and it names the interface it bound.
		assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\//);
		assert.doesNotMatch(server.url, /0\.0\.0\.0/);
	});

	it("serves nothing without the token, on every route", async () => {
		const { server, token } = await start();
		const base = origin(server);
		for (const path of ["/", "/state", "/events"]) {
			assert.equal((await fetch(base + path)).status, 401, `${path} without a token`);
			assert.equal((await fetch(`${base}${path}?t=wrong`)).status, 401, `${path} with a wrong token`);
		}
		assert.equal((await fetch(`${base}/?t=${token}`)).status, 200);
	});

	it("has no route that can write when writes are off", async () => {
		const { server, recorded, token } = await start({ allowWrites: false });
		for (const path of ["/prompt", "/steer", "/abort"]) {
			const response = await post(server, path, token, { content: "hi" });
			assert.equal(response.status, 403, `${path} in read-only mode`);
		}
		assert.equal(recorded.submitted.length, 0);
		assert.equal(recorded.aborted, 0);
	});

	it("rejects a foreign Origin on writes, and accepts its own", async () => {
		const { server, token } = await start({ allowWrites: true });
		const foreign = await post(server, "/prompt", token, { content: "hi" }, "http://evil.example");
		assert.equal(foreign.status, 403);

		const own = await post(server, "/prompt", token, { content: "hi" }, `http://127.0.0.1:${server.port}`);
		assert.equal(own.status, 202);
	});

	it("accepts a request with no Origin, because no browser sends one", async () => {
		const { server, token, recorded } = await start({ allowWrites: true });
		const response = await post(server, "/prompt", token, { content: "from curl" });
		assert.equal(response.status, 202);
		assert.equal(recorded.submitted.length, 1);
	});

	it("refuses a write without the token even when the Origin is right", async () => {
		const { server, recorded } = await start({ allowWrites: true });
		const response = await post(server, "/prompt", "wrong", { content: "hi" }, `http://127.0.0.1:${server.port}`);
		assert.equal(response.status, 401);
		assert.equal(recorded.submitted.length, 0);
	});

	it("passes the client's requestId through, so a retry is one submission", async () => {
		const { server, token, recorded } = await start({ allowWrites: true });
		await post(server, "/prompt", token, { content: "hi", requestId: "abc" });
		const first = recorded.submitted[0] as { requestId?: string };
		assert.equal(first.requestId, "abc");
	});

	it("does not abort the run when the reader disconnects", async () => {
		const { server, recorded, token } = await start();
		const controller = new AbortController();
		controller.abort();
		// A request that is aborted client-side still reaches the handler and closes.
		await fetch(`${origin(server)}/events?t=${token}`, { signal: controller.signal }).catch(() => undefined);
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.equal(recorded.aborted, 0, "a disconnect must never call abort()");
	});

	it("sends a whole view as the first frame, because pi-durable does not replay", async () => {
		const { server, token } = await start();
		const response = await fetch(`${origin(server)}/events?t=${token}`);
		assert.equal(response.status, 200);
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		const { value } = await reader.read();
		const text = new TextDecoder().decode(value);
		assert.match(text, /^data: /);
		const frame = JSON.parse(text.slice("data: ".length).trim()) as { type: string; value: { entries: unknown[] } };
		assert.equal(frame.type, "snapshot");
		assert.ok(Array.isArray(frame.value.entries));
		await reader.cancel();
	});

	it("ships a page that makes no external request", () => {
		const urls = PAGE.match(/https?:\/\/[^"' )]+/g) ?? [];
		assert.deepEqual(urls, [], `the page must not fetch anything: ${urls.join(", ")}`);
		assert.doesNotMatch(PAGE, /<script[^>]+src=/);
		assert.doesNotMatch(PAGE, /<link[^>]+stylesheet/);
	});
});
