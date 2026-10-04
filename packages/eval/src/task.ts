import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Budget } from "./metrics.ts";

export class TaskError extends Error {
	override readonly name = "TaskError";
}

/**
 * A deterministic success predicate, defined outside the configuration under test.
 *
 * Every variant is evaluated by the harness, in the run directory, from a
 * command or a file. None of them asks a model. Decision record 0007 is the
 * reason: in that study the instruction set scored better on its own linter and
 * lost on every measure a reader could see. A model-graded rubric is the same
 * trap with more steps, because the grader and the graded share a bias.
 */
export type SuccessCheck =
	| { readonly kind: "command"; readonly command: string }
	| { readonly kind: "exitCode"; readonly command: string; readonly expect: number }
	| { readonly kind: "fileEquals"; readonly path: string; readonly content: string }
	| { readonly kind: "fileContains"; readonly path: string; readonly text: string };

export interface Task {
	readonly id: string;
	readonly dir: string;
	/** What the agent is asked. */
	readonly prompt: string;
	/** How success is decided after the run. */
	readonly check: SuccessCheck;
	/** Per-task ceiling, overriding the run default. */
	readonly budget?: Budget;
	/** Files written into the run directory before the agent starts. Relative path to content. */
	readonly fixture: ReadonlyMap<string, string>;
	/** Scripted model responses, when the task ships a recorded transcript. */
	readonly script?: readonly AssistantMessage[];
}

const CHECK_KINDS: ReadonlySet<string> = new Set(["command", "exitCode", "fileEquals", "fileContains"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reject a path that would escape the run directory.
 *
 * The fixture and the checks both address files by relative path. Without this,
 * a task file is an arbitrary read and an arbitrary write.
 */
export function resolveInside(root: string, relative: string): string {
	if (path.isAbsolute(relative)) {
		throw new TaskError(`path must be relative to the run directory: ${relative}`);
	}
	const resolved = path.resolve(root, relative);
	const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
	if (resolved !== root && !resolved.startsWith(prefix)) {
		throw new TaskError(`path escapes the run directory: ${relative}`);
	}
	return resolved;
}

function parseCheck(raw: unknown, file: string): SuccessCheck {
	if (!isRecord(raw)) {
		throw new TaskError(`${file}: "check" must be an object`);
	}
	const kind = raw["kind"];
	if (typeof kind !== "string" || !CHECK_KINDS.has(kind)) {
		throw new TaskError(`${file}: "check.kind" must be one of ${[...CHECK_KINDS].join(", ")}`);
	}
	switch (kind) {
		case "command": {
			const command = raw["command"];
			if (typeof command !== "string" || command.trim() === "") {
				throw new TaskError(`${file}: "check.command" must be a non-empty string`);
			}
			return { kind, command };
		}
		case "exitCode": {
			const command = raw["command"];
			const expect = raw["expect"];
			if (typeof command !== "string" || command.trim() === "") {
				throw new TaskError(`${file}: "check.command" must be a non-empty string`);
			}
			if (typeof expect !== "number" || !Number.isInteger(expect)) {
				throw new TaskError(`${file}: "check.expect" must be an integer`);
			}
			return { kind, command, expect };
		}
		case "fileEquals": {
			const filePath = raw["path"];
			const content = raw["content"];
			if (typeof filePath !== "string" || filePath === "") {
				throw new TaskError(`${file}: "check.path" must be a non-empty string`);
			}
			if (typeof content !== "string") {
				throw new TaskError(`${file}: "check.content" must be a string`);
			}
			return { kind, path: filePath, content };
		}
		default: {
			const filePath = raw["path"];
			const text = raw["text"];
			if (typeof filePath !== "string" || filePath === "") {
				throw new TaskError(`${file}: "check.path" must be a non-empty string`);
			}
			if (typeof text !== "string" || text === "") {
				throw new TaskError(`${file}: "check.text" must be a non-empty string`);
			}
			return { kind: "fileContains", path: filePath, text };
		}
	}
}

function parseBudget(raw: unknown, file: string): Budget | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (!isRecord(raw)) {
		throw new TaskError(`${file}: "budget" must be an object`);
	}
	const budget: { maxCostUSD?: number; maxWallMs?: number; maxTurns?: number } = {};
	for (const key of ["maxCostUSD", "maxWallMs", "maxTurns"] as const) {
		const value = raw[key];
		if (value === undefined) {
			continue;
		}
		if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
			throw new TaskError(`${file}: "budget.${key}" must be a positive number`);
		}
		budget[key] = value;
	}
	return budget;
}

async function readFixture(dir: string): Promise<Map<string, string>> {
	const files = new Map<string, string>();
	const root = path.join(dir, "fixture");

	const walk = async (current: string): Promise<void> => {
		let entries;
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const absolute = path.join(current, entry.name);
			if (entry.isDirectory()) {
				await walk(absolute);
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}
			files.set(path.relative(root, absolute).split(path.sep).join("/"), await readFile(absolute, "utf8"));
		}
	};

	await walk(root);
	return files;
}

async function readScript(dir: string): Promise<AssistantMessage[] | undefined> {
	const file = path.join(dir, "script.json");
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(file, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw new TaskError(`${file}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!Array.isArray(parsed)) {
		throw new TaskError(`${file}: expected a JSON array of assistant messages`);
	}
	// Only the shape is checked here. The scripted provider validates the rest
	// when it replays a message, and a malformed one fails the run loudly.
	for (const [index, entry] of parsed.entries()) {
		if (!isRecord(entry) || entry["role"] !== "assistant") {
			throw new TaskError(`${file}: entry ${index} is not an assistant message`);
		}
	}
	return parsed as AssistantMessage[];
}

/**
 * Load one task from `tasks/<id>/`.
 *
 * A task with no success predicate fails here rather than at report time. A
 * task that cannot fail is not a measurement, and admitting one silently is how
 * a suite fills with cases that always pass.
 */
export async function loadTask(dir: string): Promise<Task> {
	const id = path.basename(dir);
	const file = path.join(dir, "task.json");

	let raw: unknown;
	try {
		raw = JSON.parse(await readFile(file, "utf8"));
	} catch (error) {
		throw new TaskError(`${file}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(raw)) {
		throw new TaskError(`${file}: expected a JSON object`);
	}

	const prompt = raw["prompt"];
	if (typeof prompt !== "string" || prompt.trim() === "") {
		throw new TaskError(`${file}: "prompt" must be a non-empty string`);
	}
	if (raw["check"] === undefined) {
		throw new TaskError(
			`${file}: no "check". Every task needs a deterministic success predicate; a task that cannot fail is not a measurement.`,
		);
	}

	const script = await readScript(dir);
	const task: Task = {
		id: typeof raw["id"] === "string" ? raw["id"] : id,
		dir,
		prompt,
		check: parseCheck(raw["check"], file),
		fixture: await readFixture(dir),
		...(script === undefined ? {} : { script }),
	};
	const budget = parseBudget(raw["budget"], file);
	if (budget === undefined) {
		return task;
	}
	return { ...task, budget };
}

/** Task directories under a tasks root, sorted for stable output. */
export async function listTasks(tasksDir: string): Promise<string[]> {
	let entries;
	try {
		entries = await readdir(tasksDir, { withFileTypes: true });
	} catch {
		return [];
	}
	const ids: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) {
			continue;
		}
		const manifest = path.join(tasksDir, entry.name, "task.json");
		try {
			if ((await stat(manifest)).isFile()) {
				ids.push(entry.name);
			}
		} catch {
			// A directory without a manifest is not a task.
		}
	}
	return ids.sort();
}

export interface CheckResult {
	readonly ok: boolean;
	readonly detail: string;
}

function run(command: string, cwd: string): Promise<{ code: number | null; output: string }> {
	return new Promise((resolve) => {
		const child = spawn("/bin/bash", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.on("error", (error: Error) => resolve({ code: null, output: `${output}\n${error.message}` }));
		child.on("close", (code: number | null) => resolve({ code, output }));
	});
}

/** Evaluate a task's predicate in the run directory. */
export async function evaluateCheck(check: SuccessCheck, cwd: string): Promise<CheckResult> {
	switch (check.kind) {
		case "command": {
			const result = await run(check.command, cwd);
			const ok = result.code === 0;
			return {
				ok,
				detail: ok
					? `\`${check.command}\` exited 0`
					: `\`${check.command}\` exited ${result.code ?? "unknown"}\n${result.output.trim().slice(0, 400)}`,
			};
		}
		case "exitCode": {
			const result = await run(check.command, cwd);
			return {
				ok: result.code === check.expect,
				detail: `\`${check.command}\` exited ${result.code ?? "unknown"}, expected ${check.expect}`,
			};
		}
		case "fileEquals": {
			const target = resolveInside(cwd, check.path);
			const actual = await readFile(target, "utf8").catch(() => undefined);
			if (actual === undefined) {
				return { ok: false, detail: `${check.path} does not exist` };
			}
			return {
				ok: actual === check.content,
				detail: actual === check.content ? `${check.path} matches` : `${check.path} differs`,
			};
		}
		default: {
			const target = resolveInside(cwd, check.path);
			const actual = await readFile(target, "utf8").catch(() => undefined);
			if (actual === undefined) {
				return { ok: false, detail: `${check.path} does not exist` };
			}
			return {
				ok: actual.includes(check.text),
				detail: actual.includes(check.text) ? `${check.path} contains ${JSON.stringify(check.text)}` : `${check.path} does not contain ${JSON.stringify(check.text)}`,
			};
		}
	}
}
