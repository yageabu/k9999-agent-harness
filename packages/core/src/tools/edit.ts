import type { Context } from "@earendil-works/chord";
import { defineTool } from "@earendil-works/pi-durable";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { type Static, Type } from "typebox";
import { requireEnv } from "./read.ts";

const editSchema = Type.Object({
	path: Type.String({ description: "File to edit, relative to the working directory or absolute." }),
	oldText: Type.String({ description: "Exact text to replace. It must occur exactly once in the file." }),
	newText: Type.String({ description: "Replacement text. Use an empty string to delete the match." }),
});

export type EditToolInput = Static<typeof editSchema>;

/**
 * What an edit changed, as data.
 *
 * The tool already holds both sides of an exact string replacement, so the
 * difference does not have to be computed. A renderer decides whether this
 * becomes a diff, one summary line, or a row in a table; it never has to
 * reconstruct what happened from byte counts.
 */
export type FileChange = {
	path: string;
	/** 1-indexed line where the replacement starts. */
	line: number;
	/** Lines the replacement removed. */
	removed: string[];
	/** Lines it added. */
	added: string[];
};

export type EditToolDetails = {
	path: string;
	replaced: number;
	bytesBefore: number;
	bytesAfter: number;
	change: FileChange;
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

/** Split into lines without inventing a trailing empty line for a final newline. */
function splitLines(text: string): string[] {
	if (text === "") {
		return [];
	}
	const lines = text.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines;
}

export const editTool = defineTool({
	name: "edit",
	description:
		"Replace an exact string in a file. oldText must occur exactly once, otherwise the edit fails and you must supply more context.",
	parameters: editSchema,
	execute: async (params: EditToolInput, api, context: Context): Promise<ToolExecutionResult<EditToolDetails>> => {
		const env = requireEnv(api as ToolExecutionApi<never>);
		const absolute = await env.absolutePath(params.path, context);
		if (!absolute.ok) {
			throw new Error(`edit ${params.path}: ${absolute.error.code}`);
		}
		const target = absolute.value;

		const read = await env.readTextFile(target, context);
		if (!read.ok) {
			throw new Error(`edit ${target}: ${read.error.code}`);
		}
		const before = read.value;

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

		const at = before.indexOf(params.oldText);
		const after = before.replace(params.oldText, params.newText);
		const written = await env.writeFile(target, after, context);
		if (!written.ok) {
			throw new Error(`edit ${target}: ${written.error.code}`);
		}

		const removed = splitLines(params.oldText);
		const added = splitLines(params.newText);
		const change: FileChange = {
			path: target,
			// Count the newlines before the match; the replacement starts on the next line.
			line: before.slice(0, at).split("\n").length,
			removed,
			added,
		};

		return {
			// Line counts rather than byte counts: the caller is a model, and "+3 -1"
			// says more about what happened than "412 -> 455 bytes".
			content: [{ type: "text", text: `edited ${target} (+${added.length} -${removed.length})` }],
			details: {
				path: target,
				replaced: 1,
				bytesBefore: before.length,
				bytesAfter: after.length,
				change,
			},
		};
	},
});

export type EditTool = typeof editTool;
