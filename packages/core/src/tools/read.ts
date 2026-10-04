import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";

const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;

const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read, relative to the working directory or absolute." }),
	offset: Type.Optional(Type.Number({ description: "1-indexed line number to start reading from." })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read." })),
});

export type ReadToolInput = Static<typeof readSchema>;

export interface ReadToolDetails {
	path: string;
	lines: number;
	totalLines: number;
	truncated: boolean;
}

/** `read` — return numbered lines from a text file. */
export function createReadTool(cwd: string): AgentTool<typeof readSchema, ReadToolDetails> {
	return {
		name: "read",
		label: "Read",
		description: `Read a text file and return numbered lines. Returns at most ${MAX_LINES} lines or 50KB.`,
		parameters: readSchema,
		execute: async (_toolCallId, params, signal) => {
			const target = path.isAbsolute(params.path) ? params.path : path.resolve(cwd, params.path);

			const options: { encoding: "utf8"; signal?: AbortSignal } = { encoding: "utf8" };
			if (signal) {
				options.signal = signal;
			}
			const text = await readFile(target, options);

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
	};
}
