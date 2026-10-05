#!/usr/bin/env node
/**
 * Publish the package to GitHub Packages as well as npmjs.
 *
 * GitHub Packages requires the package name to be scoped to the account that
 * owns the repository, so `k9999` cannot go there under its own name. This
 * stages a copy under `@yageabu/k9999` and publishes that, which keeps the
 * unscoped name on npmjs — and keeps `npx k9999` working — while making the
 * same build available from GitHub.
 *
 * The repository manifest is never modified. A failure part way through leaves
 * the workspace exactly as it was.
 *
 *   GITHUB_TOKEN=ghp_... node scripts/publish-github-packages.mjs
 *   GITHUB_TOKEN=ghp_... node scripts/publish-github-packages.mjs --dry-run
 *
 * The token needs `write:packages`. A classic token with only `repo` will
 * authenticate and then be refused at the upload.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const OWNER = "yageabu";
const REGISTRY = "https://npm.pkg.github.com";
const SCOPED_NAME = `@${OWNER}/k9999`;

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliDir = path.join(repoRoot, "packages/cli");
const dryRun = process.argv.includes("--dry-run");

const token = process.env["GITHUB_TOKEN"] ?? process.env["NODE_AUTH_TOKEN"] ?? process.env["GH_TOKEN"];
if (!token) {
	process.stderr.write(
		"Set GITHUB_TOKEN to a token with `write:packages`.\n" +
			"Classic tokens need that scope explicitly; `repo` alone is not enough.\n",
	);
	process.exit(2);
}

// 1. The build has to be current, or GitHub would get a different artifact than
//    npmjs did. `prepublishOnly` runs on the real publish; this is for --dry-run
//    and for failing before any staging happens.
const build = spawnSync("npm", ["run", "build", "--workspace", "k9999"], { cwd: repoRoot, stdio: "inherit" });
if (build.status !== 0) {
	process.exit(build.status ?? 1);
}

// 2. Stage. `dist` plus the files the manifest lists, nothing else.
const stage = await mkdtemp(path.join(tmpdir(), "k9999-github-"));
try {
	const manifest = JSON.parse(await readFile(path.join(cliDir, "package.json"), "utf8"));
	manifest.name = SCOPED_NAME;
	// The repository field must match the GitHub URL or the publish is refused.
	manifest.repository = {
		type: "git",
		url: `git+https://github.com/${OWNER}/k9999-agent-harness.git`,
		directory: "packages/cli",
	};
	manifest.publishConfig = { access: "public", registry: `${REGISTRY}/` };
	// The staging copy is already built; do not rebuild here, and do not run the
	// repository check from a temporary directory.
	delete manifest.scripts;

	const files = ["dist", "README.md", "CHANGELOG.md", "LICENSE"];
	for (const entry of files) {
		await cp(path.join(cliDir, entry), path.join(stage, entry), { recursive: true });
	}
	await writeFile(path.join(stage, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");

	// 3. Publish with a config that only affects this invocation.
	const npmrc = path.join(stage, ".npmrc");
	await writeFile(
		npmrc,
		`${SCOPED_NAME.split("/")[0]}:registry=${REGISTRY}/\n//npm.pkg.github.com/:_authToken=${token}\n`,
		{ mode: 0o600 },
	);

	const args = ["publish", "--registry", REGISTRY, "--userconfig", npmrc];
	if (dryRun) {
		args.push("--dry-run");
	}
	process.stdout.write(`${dryRun ? "[dry run] " : ""}publishing ${SCOPED_NAME}@${manifest.version} to ${REGISTRY}\n`);
	const publish = spawnSync("npm", args, { cwd: stage, stdio: "inherit" });
	process.exitCode = publish.status ?? 1;
} finally {
	await rm(stage, { recursive: true, force: true });
}
