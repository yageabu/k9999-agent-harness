import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Redactor } from "../redact.ts";
import { ConfigurationError } from "../errors.ts";
import { createBashTool } from "./bash.ts";
import { createEditTool } from "./edit.ts";
import { createReadTool } from "./read.ts";

/** Tool type with its schema and details erased, for registries and lists. */
export type AnyTool = AgentTool<any, any>;

/**
 * What a tool needs from the harness that is not the working directory.
 *
 * Only `bash` spawns a process, so only `bash` uses these today. They are passed
 * to every factory rather than special-cased, because the next tool that runs
 * something should have to decide about the environment rather than inherit one
 * by not being asked.
 */
export interface ToolBuildOptions {
	/** Names a subprocess may read. See `./env.ts` for the default. */
	env?: readonly string[];
	/** The parent environment, injected so a test needs no host. */
	source?: Record<string, string | undefined>;
	redactor?: Redactor;
}

export interface ToolFactory {
	readonly name: string;
	build(cwd: string, options?: ToolBuildOptions): AnyTool;
}

/**
 * The tool registry.
 *
 * A profile names tools by string; this table is the only place a name becomes
 * an implementation. Adding a tool means adding one row here plus its module.
 */
export const TOOL_FACTORIES: readonly ToolFactory[] = [
	{ name: "read", build: (cwd) => createReadTool(cwd) },
	{ name: "bash", build: (cwd, options) => createBashTool(cwd, options) },
	{ name: "edit", build: (cwd) => createEditTool(cwd) },
];

export function toolNames(): string[] {
	return TOOL_FACTORIES.map((factory) => factory.name);
}

/** Build the tools a profile asked for. An unknown name is a load-time error, not a silent skip. */
export function createTools(names: readonly string[], cwd: string, options: ToolBuildOptions = {}): AnyTool[] {
	const byName = new Map(TOOL_FACTORIES.map((factory) => [factory.name, factory]));
	return names.map((name) => {
		const factory = byName.get(name);
		if (!factory) {
			throw new ConfigurationError(`Unknown tool "${name}". Known tools: ${toolNames().join(", ")}`);
		}
		return factory.build(cwd, options);
	});
}

export { DEFAULT_TOOL_ENV, missingFromEnvironment, toolEnvironment } from "./env.ts";
export { createBashTool, type BashToolDetails, type BashToolInput, type BashToolOptions } from "./bash.ts";
export { createEditTool, type EditToolDetails, type EditToolInput, type FileChange } from "./edit.ts";
export { createReadTool, type ReadToolDetails, type ReadToolInput } from "./read.ts";
