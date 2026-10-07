# 0009 — A browser surface

**Status:** `accepted`

## Problem

K9999 has two surfaces and both are the terminal. A session is one process on one machine, and the state that describes it — the transcript, the tokens, what is running — exists only as events that a sink has already rendered and discarded.

Three things follow, and each is a real user-visible limitation rather than a wish:

- **A session cannot be looked at from anywhere else.** A long run on a build server is invisible until it ends.
- **A terminal is a stream, not a view.** The status line shows one moment. The transcript scrolls away. Nothing can be asked a question — "how much has this cost so far, per tool" — because nothing holds the whole state at once.
- **A refresh is impossible because there is no page.** Closing a terminal ends the interface, not just the window.

[SPEC 0007](0007-rendering-and-sinks.md) built the seam that makes a third surface cheap, and [ADR-0017](../decisions.md) replaced the harness underneath it with one whose state is already a view:

> `viewState()` returns the conversation's structural view as a read-only Chord state, updated after every commit that touches it.

By `pi-durable`'s own description, the transport is already designed:

> `watch()` delivers the same view with the exact Chord operations of each commit, one callback at a time. […] `await send(ops); // for example to a remote client that applies them`

## Invariant

**The browser is another reader of committed state, not a second implementation of the session.** It holds no authority: everything it draws was committed before it was sent, and everything it sends is a submission the harness may reject, queue, or refuse.

The consequence that makes this worth stating: **closing the tab loses the tab and nothing else.** A run keeps going, a queued input stays queued, and reopening attaches to the current view rather than replaying a history.

## What is adopted, not built

The pieces below exist and are not this spec's work. Naming them is the point — the previous plan called for designing all of it.

| Need | Provided by |
|---|---|
| State to send, and the operations between states | `Conversation.watch()` → `ConversationWatch`, and `Conversation.viewState()` |
| A late or reconnecting client | `watch.value` is the state at attachment. "A client that joins late or reconnects starts from the current view; nothing is replayed" |
| Sending a prompt | `Conversation.submit()` → `Submission` |
| A busy conversation | `submit({ whenBusy: "steer" \| "reject" })`; pending items appear in `docs["pi.inbox"]` |
| Stopping a run | `Conversation.abort()` |
| Surviving a server restart | `Harness.open(storage, …)` plus `harness.resume()`, on SQLite or JSONL |
| Which model, tools, and cwd a conversation runs with | `docs["pi.agent"]` |
| Tokens and cost, for [SPEC 0004](0004-measurement-and-budget.md) | `docs["pi.usage"]` and `harness.usage()` |

**Nothing in that column requires a new concept.** The work is a server that carries these to a browser and back.

## Tier A — the read-only view

A process that opens a `Harness` on a conversation and serves its view.

- **`GET /`** returns one HTML document, from disk, with no build step and no framework.
- **`GET /events`** is a Server-Sent Events stream. The first frame is `watch.value`; each later frame is one commit's operations, serialized as JSON.
- **`GET /state`** returns the current view. SSE reconnects are routine, and a client that reconnects mid-stream needs a fresh base rather than a resumed one.

SSE rather than WebSocket because the traffic is one-way, the framing is already line-oriented, and reconnect is built into the protocol. Tier B adds writes, which are ordinary POSTs.

What the page draws, and the rule for each row:

| Shown | Source | Why it is here |
|---|---|---|
| The active transcript, with diffs from `ToolResultEntry` | `view.entries` | Not on the wire — a deleted file is nowhere in the request body |
| The running generation's streamed partial | `docs["pi.live"]` | Same reason |
| Tool calls in flight, with their output | `docs["pi.live"].tools` | Same |
| Queued steers and follow-ups | `docs["pi.inbox"]` | A queue exists only in the harness |
| Tokens, cache, and cost, per model and per tool | `docs["pi.usage"]` | Per **tool** is not on the wire |
| Model, thinking level, tools, cwd | `docs["pi.agent"]` | Resolved from a registry the request cannot see |
| Busy or idle, and the pending count | derived | The answer to "is it stuck?" |

**ADR-0015's division holds, and it is the reason this table is short.** The system prompt as sent, the tool schemas, the request bodies, and a turn-to-turn diff of them are [ccglass](../decisions.md)'s job, because a proxy sees what went out and the harness can only see what it meant to send. The page must not grow a request inspector.

## Tier B — writes

The same server, with four endpoints. Each is one call on an API that already exists.

| Endpoint | Call | Notes |
|---|---|---|
| `POST /prompt` | `submit({ type: "input", content, requestId })` | `requestId` comes from the client, so a double-click or a retried POST is one submission |
| `POST /steer` | `submit({ …, whenBusy: "steer" })` | Rejected while idle, rather than silently becoming a follow-up |
| `POST /abort` | `abort()` | Withdraws queued inputs; queued writes stay |
| `POST /answer` | A write submission | For [SPEC 0001](0001-non-blocking-interaction.md)'s interactions, once their entry kind exists |

`whenBusy: "reject"` is what makes the first endpoint honest: a submission to a busy conversation is either queued deliberately or refused with `ConversationBusy`, and the client is told which. Silently queuing is the behavior that makes a UI feel broken.

## Security

A local port that accepts a prompt and runs `bash` is a remote code execution surface with a web form in front of it. This is the same class of decision as the one [ADR-0001](../decisions.md) records about `.env`: a harness that trusts its surroundings can be redirected by them.

The rules, all of them enforceable in tests:

1. **Bind `127.0.0.1`.** Not `0.0.0.0`, not a flag that relaxes it. Serving this on a network interface turns a convenience into an open door.
2. **No CORS headers.** A page on another origin must not be able to read the stream or post a prompt.
3. **Require a token**, minted at startup and printed as part of the URL the user opens. It defends against the browser being the attacker — any page in any tab can POST to localhost, and a token in the path is what stops it.
4. **Validate `Origin`** on every write, rejecting any that is present and not the server's own.
5. **Read-only by default.** Tier A's server has no write endpoint, and the token only gates reads. Serving prompts is a flag, so the dangerous mode is the one that must be asked for.

## Acceptance criteria

1. A test asserts the server binds `127.0.0.1` and that a connection to a non-loopback address fails.
2. A test asserts a request whose `Origin` header is present and foreign is rejected on every write endpoint, and that a request with no `Origin` — a `curl`, which no browser sends — is accepted only with a valid token.
3. A test asserts a request with a missing or wrong token gets 401 and does not reach `submit()`.
4. A test asserts the Tier A server exposes no endpoint that can call `submit()`, `abort()`, or `reset()`, by reading the route table rather than by convention.
5. A test asserts a `POST /prompt` with a `requestId` that has already been submitted results in one submission, not two.
6. A test asserts a `POST /steer` against an idle conversation is rejected with `ConversationBusy` and writes nothing.
7. A test asserts the SSE stream's first frame is a whole view, and that every later frame applies to the previous one without a gap — driven against a scripted provider, so it needs no credentials.
8. A test asserts a client that connects mid-run receives the current view and not a replay, by counting frames against a run whose earlier commits are already stored.
9. A test asserts the page makes no external request: no CDN, no font, no framework. Checked the same way `scripts/check-site.mjs` checks `site/`, because "no external requests" is already a rule here and the reason does not change with the artifact.
10. A test asserts closing the SSE connection does not call `abort()`, by asserting a run continues to completion after every client disconnects.

## Out of scope

- **A framework.** One HTML file, one CSS block, and the browser's own `EventSource`. A build step for a page that draws a list and a few numbers is a dependency that has to be upgraded forever. [pi-web-ui](https://www.npmjs.com/package/@earendil-works/pi-web-ui) exists and is Lit-based; it is the thing to reach for when the page needs file previews or a document viewer, which is not this.
- **Serving it from `site/`.** The product page is enforced to make zero external requests and to be openable as a file. A server is a different artifact with a different threat model, and it does not belong in the same directory or the same workflow.
- **Agents driving the browser.** No browser automation, no screenshots, no DOM. The surface is for a person.
- **Multi-user access, authentication beyond a token, or TLS.** This runs on a laptop, for one person, on the loopback interface. Every one of those three is a deployment question, and answering it here would mean answering it wrong for the laptop.
- **A second state format for the client.** The browser applies `pi-durable`'s view shape as it arrives. Mapping it into a K9999-shaped model would create a second source of truth for the same facts, which is the failure [ADR-0012](../decisions.md) records in its cheapest form.
