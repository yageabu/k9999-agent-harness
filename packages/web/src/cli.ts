import { randomBytes } from "node:crypto";
import { loadSession } from "@k9999/core";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createWebServer } from "./server.ts";
import { createWireRecorder } from "./wire.ts";

/**
 * Start the browser surface.
 *
 * This runs on K9999's own profile rather than on pi-durable's built-in coding
 * tools, which is what makes the request pane show a prompt at all: a profile's
 * `system.md` is a `PromptSection`, and before this the pane said the prompt
 * arrived as sections it could not see.
 */

interface Options {
	storage: string;
	cwd: string;
	model?: string;
	profile: string;
	writes: boolean;
	port: number;
}

function parse(argv: readonly string[]): Options {
	const options: Options = {
		storage: ".k9999/session.sqlite",
		cwd: process.cwd(),
		profile: "code",
		writes: false,
		port: 0,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--storage") options.storage = argv[++i] ?? options.storage;
		else if (arg === "--cwd") options.cwd = argv[++i] ?? options.cwd;
		else if (arg === "--model") {
			const value = argv[++i];
			if (value !== undefined) options.model = value;
		} else if (arg === "--profile") options.profile = argv[++i] ?? options.profile;
		else if (arg === "--writes") options.writes = true;
		else if (arg === "--port") options.port = Number(argv[++i] ?? "0");
		else if (arg === "-h" || arg === "--help") {
			process.stdout.write(
				[
					"k9999-web — a browser surface for K9999",
					"",
					"  --profile <id>     the profile to run (default code)",
					"  --storage <path>   SQLite file for the session (default .k9999/session.sqlite)",
					"  --cwd <path>       the directory the agent works in (default: current)",
					"  --model <ref>      provider/modelId, overriding the profile",
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
	if (!process.env.DEEPSEEK_API_KEY) {
		process.stderr.write(
			"DEEPSEEK_API_KEY is not set.\n\n  export DEEPSEEK_API_KEY=sk-...   (bash, zsh)\n  $env:DEEPSEEK_API_KEY=\"sk-...\"  (PowerShell)\n  set DEEPSEEK_API_KEY=sk-...      (cmd)\n\nThen start again.\n",
		);
		process.exit(2);
	}

	// The request inspector is an extension like any other, installed beside the
	// profile's. It is not durable — see `wire.ts`.
	const wire = createWireRecorder();
	const session = await loadSession({
		profile: options.profile,
		cwd: options.cwd,
		storage: await openNodeSqliteStorage(options.storage),
		...(options.model === undefined ? {} : { model: options.model }),
		extensions: [wire.extension],
	});

	// The recorder cannot see a profile prompt through the request messages, because
	// pi-durable delivers one positionally. Binding the conversation lets it render
	// the sections instead, and say which route it took.
	wire.bind(session.conversation);

	const token = randomBytes(24).toString("base64url");
	const server = await createWebServer({
		harness: session.harness,
		conversation: session.conversation,
		token,
		allowWrites: options.writes,
		port: options.port,
		wire,
	});

	process.stdout.write(`\n  K9999 web\n\n    ${server.url}\n\n`);
	process.stdout.write(`    ${options.writes ? "reads and writes" : "read-only"} · ${session.profile.id} · ${session.modelRef}\n`);
	process.stdout.write(`    cwd ${options.cwd}\n    storage ${options.storage}\n`);
	if (session.redacting.length > 0) {
		process.stdout.write(`    redacting ${session.redacting.join(", ")}\n`);
	}
	if (session.envMissing.length > 0) {
		process.stdout.write(`    declared but absent from this host: ${session.envMissing.join(", ")}\n`);
	}
	process.stdout.write("\n");
	if (!options.writes) {
		process.stdout.write("    Read-only. Add --writes to send prompts from the page.\n\n");
	}
	process.stdout.write("    The URL carries the token. Anyone who has it can read this session.\n\n");

	const shutdown = async (): Promise<void> => {
		await server.close();
		await session.close();
		process.exit(0);
	};
	process.on("SIGINT", () => void shutdown());
	process.on("SIGTERM", () => void shutdown());
}

await main();
