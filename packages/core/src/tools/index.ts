import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolExecutionApi, ToolRegistration } from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { Redactor } from "../redact.ts";
import { ConfigurationError } from "../errors.ts";
import { createBashTool } from "./bash.ts";
import { editTool } from "./edit.ts";
import { readTool } from "./read.ts";
import { guardedEnv } from "./guarded-env.ts";
import { DEFAULT_TOOL_ENV } from "./env.ts";

/**
 * ## This file is a bridge, and it is scheduled to be deleted.
 *
 * K9999 has two paths right now (ADR-0017). `packages/web` runs on `pi-durable`,
 * where a tool is a `ToolRegistration` that receives an `ExecutionEnv`. The
 * terminal and the evaluator still run on `pi-agent-core`, where a tool is an
 * `AgentTool` that spawns its own process — and their rendering is built on that
 * agent's event stream, which is the piece of work still outstanding.
 *
 * Writing the read, bash, and edit tools twice would be the alternative, and the
 * two copies would drift within a week. So this adapts one to the other, and
 * disappears with the old path.
 */

/** Tool type with its schema and details erased, for registries and lists. */
export type AnyTool = AgentTool<any, any>;

export interface ToolBuildOptions {
	/** Names a subprocess may read. See `./env.ts` for the default. */
	env?: readonly string[];
	/** The parent environment, injected so a test needs no host. */
	source?: Record<string, string | undefined>;
	redactor?: Redactor;
	/** Overrides the environment entirely, for a test that wants no subprocess. */
	executionEnv?: ExecutionEnv;
}

function build(registration: ToolRegistration, env: ExecutionEnv): AgentTool<any, any> {
	// The API a tool receives is wide — documents, diagnostics, memo, output. The
	// three tools here use `env` and nothing else, so this supplies that and
	// nothing pretends to be the rest. A tool added to the old path that needs
	// more should be migrated rather than given a bigger stub.
	const api = {
		env,
		taskId: "legacy",
		conversationId: "legacy",
		callId: "legacy",
		registry: undefined,
		output: () => {},
		details: async () => {},
		diagnostic: () => {},
		memo: async () => undefined,
	} as unknown as ToolExecutionApi<never>;

	return {
		name: registration.name,
		label: registration.name,
		description: registration.description,
		parameters: registration.parameters,
		execute: async (_toolCallId: string, params: unknown, signal?: AbortSignal) => {
			const context = BACKGROUND_CONTEXT as Context;
			void signal;
			const result = await registration.execute(params as never, api, context);
			// `details` is carried through: it is where the structured `FileChange` lives,
			// and the diff renderer reads it. Dropping it here would quietly remove the
			// reason SPEC 0007's first acceptance criterion exists.
			return {
				content: result.content ?? [{ type: "text", text: "" }],
				...(result.isError === undefined ? {} : { isError: result.isError }),
				...(result.details === undefined ? {} : { details: result.details }),
			} as never;
		},
	} as unknown as AgentTool<any, any>;
}

/** Build the tools a profile asked for, on the retiring path. */
export function createTools(names: readonly string[], cwd: string, options: ToolBuildOptions = {}): AnyTool[] {
	const env =
		options.executionEnv ??
		guardedEnv({
			inner: new NodeExecutionEnv({ cwd }),
			...(options.source === undefined ? {} : { source: options.source }),
			allow: options.env ?? DEFAULT_TOOL_ENV,
		});

	return names.map((name) => {
		switch (name) {
			case "read":
				return build(readTool, env);
			case "edit":
				return build(editTool, env);
			case "bash":
				return build(
					options.redactor === undefined ? createBashTool() : createBashTool({ redactor: options.redactor }),
					env,
				);
			default:
				// A configuration mistake, not a defect: exit 2 with the message and no stack
				// trace. `--show` depends on this being the right class, because that is how
				// it refuses a profile naming a tool that does not exist.
				throw new ConfigurationError(`Unknown tool "${name}". Known tools: ${toolNames().join(", ")}`);
		}
	});
}

export function toolNames(): string[] {
	return ["read", "bash", "edit"];
}

export { DEFAULT_TOOL_ENV, missingFromEnvironment, toolEnvironment } from "./env.ts";
export { guardedEnv, type GuardedEnvOptions } from "./guarded-env.ts";
export { createBashTool, type BashToolDetails, type BashToolInput, type BashToolOptions } from "./bash.ts";
export { editTool, type EditToolDetails, type EditToolInput, type FileChange } from "./edit.ts";
export { readTool, requireEnv, type ReadToolDetails, type ReadToolInput } from "./read.ts";
