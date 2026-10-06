import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readGitBranch } from "../src/tui/git.ts";

function workdir(): string {
	return mkdtempSync(path.join(tmpdir(), "k9999-git-"));
}

test("the branch comes from the repository above the working directory", () => {
	const root = workdir();
	mkdirSync(path.join(root, ".git"));
	writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
	const nested = path.join(root, "packages", "app");
	mkdirSync(nested, { recursive: true });

	assert.equal(readGitBranch(nested), "main", "a subdirectory reports the repository's branch");
});

test("a worktree's gitdir pointer is followed", () => {
	const root = workdir();
	const real = path.join(root, "real");
	mkdirSync(real, { recursive: true });
	writeFileSync(path.join(real, "HEAD"), "ref: refs/heads/feature/x\n");

	const worktree = path.join(root, "worktree");
	mkdirSync(worktree);
	writeFileSync(path.join(worktree, ".git"), `gitdir: ${real}\n`);

	assert.equal(readGitBranch(worktree), "feature/x");
});

test("a detached HEAD has no branch to name", () => {
	const root = workdir();
	mkdirSync(path.join(root, ".git"));
	writeFileSync(path.join(root, ".git", "HEAD"), `${"a".repeat(40)}\n`);
	assert.equal(readGitBranch(root), undefined, "a commit hash in the place a branch belongs reads as one");
});

test("no repository reports nothing rather than guessing", () => {
	const root = workdir();
	assert.equal(readGitBranch(root), undefined);
});
