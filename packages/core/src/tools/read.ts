import type { Context } from "@earendil-works/chord";
import { defineTool } from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { type Static, Type } from "typebox";

const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;

const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read, relative to the working directory or absolute." }),
	offset: Type.Optional(Type.Number({ description: "1-indexed line number to start reading from." })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read." })),
});

export type ReadToolInput = Static<typeof readSchema>;

export type ReadToolDetails = {
	path: string;
	lines: number;
	totalLines: number;
	truncated: boolean;
}

/** The environment a tool runs in, or a throw that becomes the call's error result. */
export function requireEnv(api: ToolExecutionApi<never>): ExecutionEnv {
	if (api.env === undefined) {
		throw new Error("This tool needs an execution environment. The harness was opened without one.");
	}
	return api.env;
}

/**
 * `read` — return numbered lines from a text file.
 *
 * The file is read through the environment rather than `node:fs`, so a
 * conversation whose environment is a container reads the file inside it. That
 * is the point of the seam: this tool never knows where its files are.
 */
export const readTool = defineTool({
	name: "read",
	description: `Read a text file and return numbered lines. Returns at most ${MAX_LINES} lines or 50KB.`,
	parameters: readSchema,
	execute: async (params: ReadToolInput, api, context: Context): Promise<ToolExecutionResult<ReadToolDetails>> => {
		const env = requireEnv(api as ToolExecutionApi<never>);
		const absolute = await env.absolutePath(params.path, context);
		if (!absolute.ok) {
			throw new Error(`read ${params.path}: ${absolute.error.code}`);
		}
		const target = absolute.value;

		const read = await env.readTextFile(target, context);
		if (!read.ok) {
			throw new Error(`read ${target}: ${read.error.code}`);
		}
		const text = read.value;

		const all = text.split("\n");
		if (all.length > 0 && all[all.length - 1] === "") {
			all.pop();
		}

		const start = Math.max(1, Math.trunc(params.offset ?? 1));
		const requested = Math.min(Math.trunc(params.limit ?? MAX_LINES), MAX_LINES);
		const slice = all.slice(start - 1, start - 1 + Math.max(0, requested));

		let body = slice.map((line, index) => `${start + index}\t${line}`).join("\n");
		let truncated = false;

		if (body.length > MAX_BYTES) {
			body = `${body.slice(0, MAX_BYTES)}\n[truncated: output exceeds 50KB]`;
			truncated = true;
		}
		const lastRead = start - 1 + slice.length;
		if (lastRead < all.length) {
			body += `\n[truncated: file has ${all.length} lines, stopped at ${lastRead}]`;
			truncated = true;
		}

		return {
			content: [{ type: "text", text: `${target}\n${body}` }],
			details: { path: target, lines: slice.length, totalLines: all.length, truncated },
		};
	},
});

export type ReadTool = typeof readTool;
