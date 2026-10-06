import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The branch a working directory is on, read from the repository's `HEAD`.
 *
 * Reading a file rather than running `git` keeps the footer free of a
 * subprocess, which matters because the footer is redrawn whenever the
 * terminal resizes or a key is pressed. The `gitdir:` indirection is handled
 * because a worktree or submodule stores its `HEAD` elsewhere.
 *
 * A detached `HEAD` holds a commit rather than a ref, and there is no branch to
 * name. That returns `undefined` instead of a hash, because a hash in the
 * place a branch belongs reads as one.
 */
export function readGitBranch(cwd: string): string | undefined {
	let dir = path.resolve(cwd);

	for (;;) {
		const gitDir = gitDirAt(dir);
		if (gitDir !== undefined) {
			const head = readFile(gitDir, "HEAD");
			if (head === undefined) {
				return undefined;
			}
			const match = /^ref:\s*refs\/heads\/(.+)$/m.exec(head);
			return match?.[1]?.trim();
		}

		const parent = path.dirname(dir);
		if (parent === dir) {
			return undefined;
		}
		dir = parent;
	}
}

/** The `.git` directory at `dir`, following a `gitdir:` pointer file. */
function gitDirAt(dir: string): string | undefined {
	const marker = path.join(dir, ".git");
	let info;
	try {
		info = statSync(marker);
	} catch {
		return undefined;
	}

	if (info.isDirectory()) {
		return marker;
	}
	if (!info.isFile()) {
		return undefined;
	}

	const pointer = readFile(marker);
	const match = pointer === undefined ? null : /^gitdir:\s*(.+)$/m.exec(pointer);
	return match?.[1] === undefined ? undefined : path.resolve(dir, match[1].trim());
}

function readFile(...parts: string[]): string | undefined {
	try {
		return readFileSync(path.join(...parts), "utf8");
	} catch {
		return undefined;
	}
}
