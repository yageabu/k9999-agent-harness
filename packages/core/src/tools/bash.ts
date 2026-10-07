import type { Context } from "@earendil-works/chord";
import { defineTool, type ToolExecutionApi, type ToolExecutionResult } from "@earendil-works/pi-durable";
import { type Static, Type } from "typebox";
import { NO_REDACTOR, type Redactor } from "../redact.ts";
import { requireEnv } from "./read.ts";

const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_OUTPUT_CHARS = 50 * 1024;

const bashSchema = Type.Object({
	command: Type.String({ description: "Shell command to execute in the working directory." }),
	timeout: Type.Optional(Type.Number({ description: `Timeout in seconds. Default ${DEFAULT_TIMEOUT_SECONDS}.` })),
});

export type BashToolInput = Static<typeof bashSchema>;

export type BashToolDetails = {
	command: string;
	exitCode: number | null;
	timeoutSeconds: number;
	truncated: boolean;
	timedOut: boolean;
	/** Labels of credentials removed from this result. Non-empty means the turn is degraded. */
	redacted: string[];
}

function cap(text: string): { text: string; truncated: boolean } {
	if (text.length <= MAX_OUTPUT_CHARS) {
		return { text, truncated: false };
	}
	return { text: `${text.slice(0, MAX_OUTPUT_CHARS)}\n[truncated: output exceeds 50KB]`, truncated: true };
}

export interface BashToolOptions {
	/** Removes credentials from the result before the model sees it (SPEC 0011, link 1). */
	redactor?: Redactor;
}

/**
 * `bash` — run a shell command and return its output and exit code.
 *
 * The command runs through the execution environment rather than a spawn this
 * file owns, which is what lets `guardedEnv` decide what the child may read.
 * Building the environment here would put the allowlist in a tool, and a tool
 * that forgets is the case the wrapper exists to make safe.
 */
export function createBashTool(options: BashToolOptions = {}) {
	const redactor = options.redactor ?? NO_REDACTOR;
	return defineTool({
		name: "bash",
		description: `Run a shell command and return its combined output and exit code. Output is limited to 50KB. Use this for builds, tests, git, and anything else you would run in a terminal.`,
		parameters: bashSchema,
		executionMode: "sequential",
		execute: async (params: BashToolInput, api, context: Context): Promise<ToolExecutionResult<BashToolDetails>> => {
			const env = requireEnv(api as ToolExecutionApi<never>);
			const timeoutSeconds = params.timeout ?? DEFAULT_TIMEOUT_SECONDS;
			const started = Date.now();

			let output = "";
			const result = await env.exec(
				params.command,
				{
					...(Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? { timeout: timeoutSeconds } : {}),
					onOutput: (text: string) => {
						// Collected whole and redacted once, below. Redacting per chunk
						// would miss a credential split across two of them.
						output += text;
					},
				},
				context,
			);

			const wallTimeSeconds = (Date.now() - started) / 1000;
			const timedOut = result.ok ? result.value.exitCode === 124 : false;
			const exitCode = result.ok ? result.value.exitCode : null;
			if (!result.ok) {
				output += `\n[spawn error: ${result.error.code}]`;
			}

			// Redact before truncating: a cap applied first can cut a credential in
			// half, and half a credential does not match the value being looked for.
			const redacted = redactor.redact(output);
			const { text, truncated } = cap(redacted.text);
			const header = `exit code: ${exitCode ?? "unknown"} | ${wallTimeSeconds.toFixed(1)}s${
				timedOut ? " | timed out" : ""
			}`;
			// A silent edit to a result the model is reasoning about is worse than the
			// credential it removed: the model cannot tell it is reading a different world.
			const notice =
				redacted.hits.length > 0
					? `\n[redacted ${redacted.hits.join(", ")}: this result was edited before you saw it]`
					: "";

			return {
				content: [{ type: "text", text: `${header}${notice}\n${text}` }],
				isError: exitCode !== 0,
				details: {
					command: redactor.redact(params.command).text,
					exitCode,
					timeoutSeconds,
					truncated,
					timedOut,
					redacted: [...redacted.hits],
				},
			};
		},
	});
}

export type BashTool = ReturnType<typeof createBashTool>;
