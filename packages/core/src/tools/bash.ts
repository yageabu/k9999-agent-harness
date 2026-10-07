import { spawn } from "node:child_process";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import { NO_REDACTOR, type Redactor } from "../redact.ts";
import { DEFAULT_TOOL_ENV, toolEnvironment } from "./env.ts";

const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_OUTPUT_CHARS = 50 * 1024;
/** Hard ceiling on what we keep in memory, so a runaway command cannot exhaust the process. */
const ACCUMULATE_LIMIT = 4 * MAX_OUTPUT_CHARS;

const bashSchema = Type.Object({
	command: Type.String({ description: "Shell command, executed as `bash -c <command>` in the working directory." }),
	timeout: Type.Optional(Type.Number({ description: `Timeout in seconds. Default ${DEFAULT_TIMEOUT_SECONDS}.` })),
});

export type BashToolInput = Static<typeof bashSchema>;

export interface BashToolDetails {
	command: string;
	exitCode: number | null;
	wallTimeSeconds: number;
	truncated: boolean;
	timedOut: boolean;
	timeoutSeconds: number;
	/** Labels of credentials removed from this result. Non-empty means the turn is degraded. */
	redacted: readonly string[];
}

export interface BashToolOptions {
	/** The parent environment to draw from. Defaults to `process.env`, injected so tests need no host. */
	source?: Record<string, string | undefined>;
	/** Names the subprocess may read. Defaults to the allowlist in `./env.ts`. */
	env?: readonly string[];
	redactor?: Redactor;
}

function cap(text: string): { text: string; truncated: boolean } {
	if (text.length <= MAX_OUTPUT_CHARS) {
		return { text, truncated: false };
	}
	return { text: `${text.slice(0, MAX_OUTPUT_CHARS)}\n[truncated: output exceeds 50KB]`, truncated: true };
}

/** `bash` — run a shell command and return combined stdout/stderr and the exit code. */
export function createBashTool(cwd: string, options: BashToolOptions = {}): AgentTool<typeof bashSchema, BashToolDetails> {
	const redactor = options.redactor ?? NO_REDACTOR;
	// Built once: the allowlist is a decision, and rebuilding it per call would
	// invite someone to make it dynamic from a value the model can reach.
	const childEnv = toolEnvironment(options.source ?? process.env, options.env ?? DEFAULT_TOOL_ENV);
	return {
		name: "bash",
		label: "Bash",
		description:
			"Run a shell command and return its combined output and exit code. Output is limited to 50KB. Use this for builds, tests, git, and anything else you would run in a terminal.",
		parameters: bashSchema,
		executionMode: "sequential",
		execute: async (_toolCallId, params, signal) => {
			const timeoutSeconds = params.timeout ?? DEFAULT_TIMEOUT_SECONDS;
			const started = Date.now();

			const run = await new Promise<{ output: string; exitCode: number | null; timedOut: boolean }>((resolve) => {
				const child = spawn("/bin/bash", ["-c", params.command], {
					cwd,
					// Without this the child inherits the whole process environment, which is
					// how the provider credential became a tool result. See `./env.ts`.
					env: childEnv,
					stdio: ["ignore", "pipe", "pipe"],
				});

				let output = "";
				let dropped = 0;
				const append = (chunk: Buffer | string): void => {
					const text = chunk.toString();
					if (output.length >= ACCUMULATE_LIMIT) {
						dropped += text.length;
						return;
					}
					output += text;
				};

				const stdout = child.stdout;
				const stderr = child.stderr;
				stdout?.on("data", append);
				stderr?.on("data", append);

				let timedOut = false;
				const timer = setTimeout(() => {
					timedOut = true;
					append(`\n[timeout after ${timeoutSeconds}s]`);
					child.kill("SIGKILL");
				}, timeoutSeconds * 1000);

				const onAbort = (): void => {
					child.kill("SIGKILL");
				};
				signal?.addEventListener("abort", onAbort, { once: true });

				let settled = false;
				const finish = (exitCode: number | null): void => {
					if (settled) {
						return;
					}
					settled = true;
					clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);
					if (dropped > 0) {
						output += `\n[${dropped} further characters discarded]`;
					}
					resolve({ output, exitCode, timedOut });
				};

				child.on("error", (error: Error) => {
					append(`\n[spawn error: ${error.message}]`);
					finish(null);
				});
				child.on("close", (code: number | null) => {
					finish(code);
				});
			});

			const wallTimeSeconds = (Date.now() - started) / 1000;
			// Redact before truncating. A cap applied first can cut a credential in half,
			// and half a credential does not match the value the redactor holds.
			const redacted = redactor.redact(run.output);
			const { text, truncated } = cap(redacted.text);
			const header = `exit code: ${run.exitCode ?? "unknown"} | ${wallTimeSeconds.toFixed(1)}s${
				run.timedOut ? " | timed out" : ""
			}`;
			// A silent edit to a result the model is reasoning about is worse than the
			// credential it removed: the model cannot tell that it is reading a
			// different world. So the removal is stated where it happened.
			const notice =
				redacted.hits.length > 0
					? `\n[redacted ${redacted.hits.join(", ")}: this result was edited before you saw it]`
					: "";

			return {
				content: [{ type: "text", text: `${header}${notice}\n${text}` }],
				details: {
					command: redactor.redact(params.command).text,
					exitCode: run.exitCode,
					wallTimeSeconds,
					truncated,
					timedOut: run.timedOut,
					timeoutSeconds,
					redacted: redacted.hits,
				},
			};
		},
	};
}
