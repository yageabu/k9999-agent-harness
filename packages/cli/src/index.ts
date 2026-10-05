#!/usr/bin/env node
import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
	ConfigurationError,
	createHarness,
	type Harness,
	listProfiles,
	loadProfile,
	resolveProfilesDir,
} from "@k9999/core";
import { createTextSink, createTranslator, initialRunState, type RenderSink } from "./render/index.ts";
import { createTuiApp } from "./tui/index.ts";
import { check, configuredRegistry, currentVersion, PI_FLAGS, render as renderUpdate } from "./update.ts";
import { DEFAULT_PROFILE, launchNameFor, launchSummary, profileForLaunchName } from "./launch.ts";

const USAGE = `k9999, kula — agent harness

Usage:
  k9999 [options] [prompt...]     the code agent
  kula  [options] [prompt...]     the data analysis agent

Options:
  -p, --profile <id>     Profile to run (default: ${launchSummary()})
      --profiles <dir>   Profiles directory (default: nearest ./profiles, then the one shipped here)
  -m, --model <ref>      Model as provider/modelId, overrides the profile
      --print            Run the prompt once and exit
  -s, --show             Print the resolved profile and exit
  -v, --version          Print the version and exit
      --tui              Use the interactive TUI (scrollback, multi-line editor)
      --no-tui           Force the plain line-based prompt
  -l, --list             List available profiles and exit
  -h, --help             Show this help

Commands:
  update                 Report whether a newer version is published

Environment:
  K9999_PROFILES   Profiles directory
  K9999_MODEL      Model as provider/modelId
  DEEPSEEK_API_KEY Credential for the default provider

Examples:
  k9999 --list
  k9999 --print "what does packages/core/src/prompt.ts do?"
  kula                                   read data, interactive
  npx k9999 --print "hello"
`;

interface Args {
	profile: string;
	profilesDir?: string;
	model?: string;
	print: boolean;
	show: boolean;
	version: boolean;
	tui?: boolean;
	/**
	 * Flags that belong to `update`.
	 *
	 * Collected rather than rejected so the command can answer them. Someone
	 * arriving from Pi types `k9999 update --extensions` first, and "Unknown
	 * option" teaches them nothing.
	 */
	piFlags: string[];
	list: boolean;
	help: boolean;
	prompt: string[];
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[], defaultProfile: string): Args {
	const args: Args = {
		profile: defaultProfile,
		print: false,
		show: false,
		version: false,
		piFlags: [],
		list: false,
		help: false,
		prompt: [],
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = (): string => {
			const value = argv[index + 1];
			if (value === undefined) {
				throw new UsageError(`${arg} requires a value`);
			}
			index += 1;
			return value;
		};

		switch (arg) {
			case "-p":
			case "--profile":
				args.profile = next();
				break;
			case "--profiles":
				args.profilesDir = next();
				break;
			case "-m":
			case "--model":
				args.model = next();
				break;
			case "--print":
				args.print = true;
				break;
			case "-s":
			case "--show":
				args.show = true;
				break;
			case "-v":
			case "--version":
				args.version = true;
				break;
			case "--tui":
				args.tui = true;
				break;
			case "--no-tui":
				args.tui = false;
				break;
			case "--extensions":
			case "--models":
			case "--all":
			case "--self":
				args.piFlags.push(arg);
				break;
			case "-l":
			case "--list":
				args.list = true;
				break;
			case "-h":
			case "--help":
				args.help = true;
				break;
			case "--":
				args.prompt.push(...argv.slice(index + 1));
				index = argv.length;
				break;
			default:
				if (arg !== undefined && arg.startsWith("-") && arg !== "-") {
					throw new UsageError(`Unknown option: ${arg}`);
				}
				if (arg !== undefined) {
					args.prompt.push(arg);
				}
				break;
		}
	}

	return args;
}

/**
 * Feed agent events through the translator into the sink.
 *
 * The failure flag is tracked here rather than inside the sink because the
 * exit code is the CLI's business, and a sink that returned one would have to
 * know it was driving a command line.
 */
function watch(harness: Harness, sink: RenderSink, cwd: string): { failure?: string } {
	const translator = createTranslator(initialRunState(harness.modelRef, cwd));
	const status: { failure?: string } = {};

	harness.agent.subscribe((event) => {
		for (const item of translator.translate(event)) {
			if (item.kind === "error") {
				status.failure ??= item.message;
			}
			if (item.kind === "toolResult" && !item.ok) {
				status.failure ??= `tool ${item.name} failed`;
			}
			sink.emit(item);
		}
		if (event.type === "agent_end") {
			sink.end?.(translator.state);
		}
	});

	return status;
}

async function runPrint(harness: Harness, status: { failure?: string }, prompt: string): Promise<number> {
	await harness.agent.prompt(prompt);
	if (status.failure !== undefined) {
		process.stderr.write(`${status.failure}\n`);
		return 1;
	}
	return 0;
}

/**
 * The interactive TUI.
 *
 * Opt-in until it has been used, rather than the default. Auto-detecting a TTY
 * is the right end state, but only once the thing it would select has been seen
 * working on a real terminal.
 */
async function runTui(harness: Harness, cwd: string, color: "auto" | "always" | "never"): Promise<number> {
	return await new Promise<number>((resolve) => {
		const app = createTuiApp({
			cwd,
			color,
			onSubmit: async (text) => {
				await harness.agent.prompt(text);
			},
			onExit: () => {
				app.stop();
				resolve(0);
			},
		});
		watch(harness, app.sink, cwd);
		app.start();
	});
}

async function runInteractive(harness: Harness, status: { failure?: string }): Promise<number> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	let exitCode = 0;
	try {
		for (;;) {
			const line = (await rl.question("> ")).trim();
			if (line === "") {
				continue;
			}
			if (line === "/exit" || line === "/quit") {
				return exitCode;
			}
			try {
				await harness.agent.prompt(line);
			} catch (error) {
				status.failure = error instanceof Error ? error.message : String(error);
			}
			if (status.failure !== undefined) {
				process.stderr.write(`error: ${status.failure}\n`);
				exitCode = 1;
				delete status.failure;
			}
		}
	} finally {
		rl.close();
	}
}

/**
 * The profiles and skills shipped inside this package.
 *
 * In the published bundle `import.meta.dirname` is `<package>/dist`, so the
 * shipped copies sit beside it. Running from source in the repository it is
 * `<repo>/packages/cli/src`, where neither exists — harmless, because the
 * walk-up from the working directory finds the repository's own first.
 */
const SHIPPED_PROFILES = path.join(import.meta.dirname, "profiles");
const SHIPPED_SKILLS = path.join(import.meta.dirname, "skills");

/**
 * Print the resolved configuration without running anything.
 *
 * It takes a built harness, which is the point: a profile naming a tool that
 * does not exist must fail here rather than at the first real run. Earlier this
 * read the manifest and printed it, so `tools: read, reed, teleport` looked fine
 * and then threw on the way into the first prompt.
 *
 * Building resolves the model and the skills too, so every load-time mistake a
 * run would hit surfaces here — with no network and no credential.
 */
function showProfile(harness: Harness, argv1: string | undefined, profilesDir: string, cwd: string): void {
	const command = argv1 === undefined ? "(unknown)" : path.basename(argv1);
	const rows: [string, string][] = [
		["command", command],
		["default from command", profileForLaunchName(argv1)],
		["profile", harness.profile.id],
		["agent", harness.profile.config.name],
		// The resolved reference, so K9999_MODEL and --model are visible here.
		["model", harness.modelRef],
		["thinking", harness.profile.config.thinkingLevel ?? "(runtime default)"],
		["tools", harness.tools.map((tool) => tool.name).join(", ") || "(none)"],
		["skills", (harness.profile.config.skills ?? []).join(", ") || "(none)"],
		["cwd", cwd],
		["profiles dir", profilesDir],
	];
	const width = Math.max(...rows.map(([label]) => label.length));
	for (const [label, value] of rows) {
		process.stdout.write(`${label.padEnd(width)}  ${value}\n`);
	}
}

async function main(): Promise<number> {
	let args: Args;
	try {
		args = parseArgs(process.argv.slice(2), profileForLaunchName(process.argv[1]));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
		return 2;
	}

	if (args.help) {
		process.stdout.write(USAGE);
		return 0;
	}

	// `update` is the only command, and it is recognised before any profile is
	// resolved because checking a version needs no configuration.
	if (args.prompt[0] === "update") {
		if (args.prompt.length > 1) {
			process.stderr.write(
				`update takes no arguments, so ${JSON.stringify(args.prompt.slice(1).join(" "))} was not understood.\n` +
					`To send that as a prompt: k9999 ${JSON.stringify(args.prompt.join(" "))}\n`,
			);
			return 2;
		}
		for (const flag of args.piFlags) {
			const why = PI_FLAGS[flag];
			if (why !== undefined) {
				process.stdout.write(`${flag}\n  ${why}\n`);
			}
		}
		if (args.piFlags.length > 0) {
			process.stdout.write("\n");
		}
		const report = await check({ current: await currentVersion(), registry: configuredRegistry() });
		process.stdout.write(`${renderUpdate(report).join("\n")}\n`);
		return 0;
	}

	if (args.piFlags.length > 0) {
		process.stderr.write(`${args.piFlags.join(", ")} only applies to \`k9999 update\`\n`);
		return 2;
	}

	const profilesDir = await resolveProfilesDir(args.profilesDir, [SHIPPED_PROFILES]);

	if (args.version) {
		process.stdout.write(`${await currentVersion()}\n`);
		return 0;
	}

	if (args.list) {
		for (const id of await listProfiles(profilesDir)) {
			const profile = await loadProfile(profilesDir, id);
			const launch = launchNameFor(id);
			process.stdout.write(
				`${id.padEnd(12)} ${profile.config.name.padEnd(22)} ${launch === undefined ? "" : `(${launch})`}\n`,
			);
		}
		return 0;
	}

	const cwd = process.cwd();

	if (args.show) {
		const profile = await loadProfile(profilesDir, args.profile);
		// Built rather than read: a profile naming a tool that does not exist must
		// fail here, not on the way into the first prompt.
		const harness = await createHarness({
			profile,
			cwd,
			...(args.model === undefined ? {} : { model: args.model }),
			skillsFallbacks: [SHIPPED_SKILLS],
		});
		showProfile(harness, process.argv[1], profilesDir, cwd);
		return 0;
	}

	const profile = await loadProfile(profilesDir, args.profile);

	const prompt = args.prompt.join(" ").trim();
	if (args.print && prompt === "") {
		process.stderr.write("--print needs a prompt\n");
		return 2;
	}

	const harness = await createHarness({
		profile,
		cwd,
		...(args.model === undefined ? {} : { model: args.model }),
		skillsFallbacks: [SHIPPED_SKILLS],
	});

	if (args.print) {
		// The answer on stdout, the progress on stderr, so a redirect captures only
		// the answer and a terminal still shows what the agent did.
		const sink = createTextSink({
			write: (chunk) => void process.stderr.write(chunk),
			writeText: (chunk) => void process.stdout.write(chunk),
			stream: process.stderr,
		});
		const status = watch(harness, sink, cwd);
		return await runPrint(harness, status, prompt);
	}

	if (args.tui === true) {
		// Refused rather than silently falling back: a fallback would answer a
		// different question than the one asked, and the TUI would otherwise write
		// escape sequences into a pipe and then wait forever for input that a pipe
		// will not send.
		if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
			process.stderr.write("--tui needs a terminal on stdin and stdout\n");
			return 2;
		}
		return await runTui(harness, cwd, "auto");
	}

	const sink = createTextSink({ header: `${profile.config.name} · ${harness.modelRef} · ${cwd}` });
	const status = watch(harness, sink, cwd);
	return await runInteractive(harness, status);
}

try {
	process.exitCode = await main();
} catch (error) {
	if (error instanceof ConfigurationError) {
		// A typo in a profile is the user's to fix, and the message names it. A
		// stack trace would bury that line and imply a defect in the harness.
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 2;
	} else {
		process.stderr.write(`fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
		process.exitCode = 1;
	}
}
