/**
 * Render preview: drive the real translate + text-sink pipeline with a scripted
 * provider, so the output can be looked at without credentials.
 *
 *   npm run preview --workspace k9999 -- [always|never]
 *
 * It works in a temporary directory and creates its own file, so running it
 * never touches the repository.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createHarness, loadProfile, resolveProfilesDir } from "@k9999/core";
import { createTextSink, createTranslator, initialRunState } from "../src/render/index.ts";

const color = (process.argv[2] ?? "always") as "always" | "never";
const repoRoot = path.resolve(import.meta.dirname, "../../..");

const work = await mkdtemp(path.join(tmpdir(), "k9999-preview-"));
await writeFile(
	path.join(work, "counter.mjs"),
	"export function countUpTo(n) {\n\tlet total = 0;\n\tfor (let i = 1; i < n; i += 1) {\n\t\ttotal += i;\n\t}\n\treturn total;\n}\n",
	"utf8",
);

const faux = fauxProvider();
faux.setResponses([
	// A response that asks for a tool must carry one, or the loop has nothing owed
	// and stops. Text and a call can share a message.
	fauxAssistantMessage(
		[
			fauxText("I will read the file before changing anything."),
			fauxToolCall("read", { path: "counter.mjs" }),
		],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage([fauxToolCall("edit", { path: "counter.mjs", oldText: "i < n", newText: "i <= n" })], {
		stopReason: "toolUse",
	}),
	fauxAssistantMessage([fauxToolCall("bash", { command: "node -e \"import('./counter.mjs').then(m=>console.log(m.countUpTo(3)))\"" })], {
		stopReason: "toolUse",
	}),
	fauxAssistantMessage(
		"The loop summed `1..n-1` because the condition was `i < n`. It now uses `i <= n`, and `countUpTo(3)` prints `6`. I did not check the other callers of this function.",
		{ stopReason: "stop" },
	),
]);

const models = createModels();
models.setProvider(faux.provider);
const profile = await loadProfile(await resolveProfilesDir(path.join(repoRoot, "profiles")), "code");
const harness = await createHarness({
	profile,
	cwd: work,
	resolvedModel: { models, model: faux.getModel(), provider: "faux", id: "faux-1" },
});

const to = (chunk: string): void => void process.stdout.write(chunk);
const sink = createTextSink({
	write: to,
	writeText: to,
	color,
	cwd: work,
	header: `${profile.config.name} · ${harness.modelRef} · ${work}`,
});

const translator = createTranslator(initialRunState(harness.modelRef, work));
harness.agent.subscribe((event) => {
	for (const item of translator.translate(event)) {
		sink.emit(item);
	}
	if (event.type === "agent_end") {
		sink.end?.(translator.state);
	}
});

await harness.agent.prompt("countUpTo(3) returns 3 instead of 6. Find out why and fix it.");
