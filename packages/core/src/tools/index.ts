import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createBashTool } from "./bash.ts";
import { createEditTool } from "./edit.ts";
import { createReadTool } from "./read.ts";

/** Tool type with its schema and details erased, for registries and lists. */
export type AnyTool = AgentTool<any, any>;

export interface ToolFactory {
	readonly name: string;
	build(cwd: string): AnyTool;
}

/**
 * The tool registry.
 *
 * A profile names tools by string; this table is the only place a name becomes
 * an implementation. Adding a tool means adding one row here plus its module.
 */
export const TOOL_FACTORIES: readonly ToolFactory[] = [
	{ name: "read", build: createReadTool },
	{ name: "bash", build: createBashTool },
	{ name: "edit", build: createEditTool },
];

export function toolNames(): string[] {
	return TOOL_FACTORIES.map((factory) => factory.name);
}

/** Build the tools a profile asked for. An unknown name is a load-time error, not a silent skip. */
export function createTools(names: readonly string[], cwd: string): AnyTool[] {
	const byName = new Map(TOOL_FACTORIES.map((factory) => [factory.name, factory]));
	return names.map((name) => {
		const factory = byName.get(name);
		if (!factory) {
			throw new Error(`Unknown tool "${name}". Known tools: ${toolNames().join(", ")}`);
		}
		return factory.build(cwd);
	});
}

export { createBashTool, createEditTool, createReadTool };
