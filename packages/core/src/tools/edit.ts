import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";

const editSchema = Type.Object({
	path: Type.String({ description: "File to edit, relative to the working directory or absolute." }),
	oldText: Type.String({ description: "Exact text to replace. It must occur exactly once in the file." }),
	newText: Type.String({ description: "Replacement text. Use an empty string to delete the match." }),
});

export type EditToolInput = Static<typeof editSchema>;

export interface EditToolDetails {
	path: string;
	replaced: number;
	bytesBefore: number;
	bytesAfter: number;
}

function countOccurrences(haystack: string, needle: string): number {
	let count = 0;
	let index = haystack.indexOf(needle);
	while (index !== -1) {
		count += 1;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return count;
}

/**
 * `edit` — exact string replacement.
 *
 * Throws rather than guessing when the match is absent or ambiguous. A tool
 * that silently picks the first of several matches is worse than a failed call.
 */
export function createEditTool(cwd: string): AgentTool<typeof editSchema, EditToolDetails> {
	return {
		name: "edit",
		label: "Edit",
		description:
			"Replace an exact string in a file. oldText must occur exactly once, otherwise the edit fails and you must supply more context.",
		parameters: editSchema,
		execute: async (_toolCallId, params, signal) => {
			const target = path.isAbsolute(params.path) ? params.path : path.resolve(cwd, params.path);

			const options: { encoding: "utf8"; signal?: AbortSignal } = { encoding: "utf8" };
			if (signal) {
				options.signal = signal;
			}
			const before = await readFile(target, options);

			if (params.oldText === "") {
				throw new Error(`edit ${target}: oldText must not be empty`);
			}
			const matches = countOccurrences(before, params.oldText);
			if (matches === 0) {
				throw new Error(`edit ${target}: oldText not found. Read the file and copy the text exactly.`);
			}
			if (matches > 1) {
				throw new Error(
					`edit ${target}: oldText matches ${matches} times. Include surrounding lines so the match is unique.`,
				);
			}

			const after = before.replace(params.oldText, params.newText);
			await writeFile(target, after, { encoding: "utf8" });

			return {
				content: [{ type: "text", text: `edited ${target} (${before.length} -> ${after.length} bytes)` }],
				details: { path: target, replaced: 1, bytesBefore: before.length, bytesAfter: after.length },
			};
		},
	};
}
