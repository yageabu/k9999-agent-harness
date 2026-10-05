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

/**
 * What an edit changed, as data.
 *
 * The tool already holds both sides of an exact string replacement, so the
 * difference does not have to be computed. A renderer decides whether this
 * becomes a diff, one summary line, or a row in a table; it never has to
 * reconstruct what happened from byte counts.
 */
export interface FileChange {
	path: string;
	/** 1-indexed line where the replacement starts. */
	line: number;
	/** Lines the replacement removed. */
	removed: readonly string[];
	/** Lines it added. */
	added: readonly string[];
}

export interface EditToolDetails {
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

			const at = before.indexOf(params.oldText);
			const after = before.replace(params.oldText, params.newText);
			await writeFile(target, after, { encoding: "utf8" });

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
				content: [
					{ type: "text", text: `edited ${target} (+${added.length} -${removed.length})` },
				],
				details: {
					path: target,
					replaced: 1,
					bytesBefore: before.length,
					bytesAfter: after.length,
					change,
				},
			};
		},
	};
}
