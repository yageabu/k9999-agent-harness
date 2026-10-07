import { randomBytes } from "node:crypto";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { createWebServer } from "./server.ts";
import { createWireRecorder } from "./wire.ts";

/**
 * Start the browser surface.
 *
 * This is the smallest thing that satisfies SPEC 0009 with real state: a
 * pi-durable Harness on a file, the coding tools, and the server. K9999's own
 * profiles and prompt assembly are not wired in yet — the harness underneath
 * moved, and the layer above it is the next piece of work.
 */

interface Options {
	storage: string;
	cwd: string;
	model: string;
	writes: boolean;
	port: number;
}

function parse(argv: readonly string[]): Options {
	const options: Options = {
		storage: ".k9999/session.sqlite",
		cwd: process.cwd(),
		model: process.env.K9999_MODEL ?? "deepseek/deepseek-flash",
		writes: false,
		port: 0,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--storage") options.storage = argv[++i] ?? options.storage;
		else if (arg === "--cwd") options.cwd = argv[++i] ?? options.cwd;
		else if (arg === "--model") options.model = argv[++i] ?? options.model;
		else if (arg === "--writes") options.writes = true;
		else if (arg === "--port") options.port = Number(argv[++i] ?? "0");
		else if (arg === "-h" || arg === "--help") {
			process.stdout.write(
				[
					"k9999-web — a browser surface for K9999",
					"",
					"  --storage <path>   SQLite file for the session (default .k9999/session.sqlite)",
					"  --cwd <path>       the directory the agent works in (default: current)",
					"  --model <ref>      provider/modelId (default: deepseek/deepseek-flash)",
					"  --writes           serve prompts and abort as well as reads. Off by default",
					"  --port <n>         0 picks a free port (default 0)",
					"",
					"Reads require the token printed in the URL. The server binds 127.0.0.1 only.",
					"",
				].join("\n"),
			);
			process.exit(0);
		}
	}
	return options;
}

async function main(): Promise<void> {
	const options = parse(process.argv.slice(2));
	const context = BACKGROUND_CONTEXT;

	const slash = options.model.indexOf("/");
	if (slash <= 0) {
		process.stderr.write(`Model must be "provider/modelId", got ${JSON.stringify(options.model)}\n`);
		process.exit(2);
	}
	const providerId = options.model.slice(0, slash);
	const modelId = options.model.slice(slash + 1);
	if (providerId !== "deepseek") {
		process.stderr.write(`Unknown provider "${providerId}". Only deepseek is wired today.\n`);
		process.exit(2);
	}
	if (!process.env.DEEPSEEK_API_KEY) {
		process.stderr.write(
			"DEEPSEEK_API_KEY is not set.\n\n  export DEEPSEEK_API_KEY=sk-...   (bash, zsh)\n  $env:DEEPSEEK_API_KEY=\"sk-...\"  (PowerShell)\n  set DEEPSEEK_API_KEY=sk-...      (cmd)\n\nThen start again.\n",
		);
		process.exit(2);
	}

	const models = createModels();
	models.setProvider(deepseekProvider());

	const registry = createRegistry();
	registry.install(CodingTools);
	// The request inspector (SPEC 0009). In process, so it needs no proxy: the
	// generation hooks hand over what ccglass would have to intercept. It is
	// memory, not a document — a request inspector is a live debugging view, and
	// committing every request body would put large blobs in the session store.
	const wire = createWireRecorder();
	registry.install(wire.extension);

	const storage = await openNodeSqliteStorage(options.storage);
	const harness = await Harness.open(
		storage,
		{
			models,
			registry,
			// A fresh environment per call, built from the conversation's cwd, so one
			// function would serve a directory per conversation or a container per
			// conversation without changing anything else.
			env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? options.cwd }),
		},
		context,
	);
	const conversation = await harness.root(context, {
		agent: { model: { provider: providerId, modelId }, cwd: options.cwd },
	});
	// Continue any run a previous process left unfinished.
	harness.resume();

	const token = randomBytes(24).toString("base64url");
	const server = await createWebServer({
		harness,
		conversation,
		token,
		allowWrites: options.writes,
		port: options.port,
		wire,
	});

	process.stdout.write(`\n  K9999 web\n\n    ${server.url}\n\n`);
	process.stdout.write(`    ${options.writes ? "reads and writes" : "read-only"} · ${options.model} · ${options.cwd}\n`);
	process.stdout.write(`    storage ${options.storage}\n\n`);
	if (!options.writes) {
		process.stdout.write("    Read-only. Add --writes to send prompts from the page.\n\n");
	}
	process.stdout.write("    The URL carries the token. Anyone who has it can read this session.\n\n");

	const shutdown = async (): Promise<void> => {
		await server.close();
		await harness.close(context);
		process.exit(0);
	};
	process.on("SIGINT", () => void shutdown());
	process.on("SIGTERM", () => void shutdown());
}

await main();
