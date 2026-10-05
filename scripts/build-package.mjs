#!/usr/bin/env node
/**
 * Build the publishable `k9999` package.
 *
 * Node refuses to strip TypeScript types for files under `node_modules`
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so a published package has
 * to be JavaScript. That constraint is why this exists, and it is worth stating
 * plainly: running the sources directly works only because the repository is
 * not inside `node_modules`.
 *
 * The bundle inlines the CLI and the `@k9999/core` workspace package, which is
 * what shipping one package means. Everything in `RUNTIME_DEPENDENCIES` stays
 * external and is resolved from `node_modules` at install time.
 *
 * esbuild's `packages: "external"` is not used, and the reason is a bug this
 * script shipped for one commit: it marks *every* bare specifier external, and
 * `@k9999/core` is a bare specifier. The bundle came out at 8 KB with core
 * still imported. The listed dependencies are explicit instead, and the build
 * fails if the output imports anything that is not on the list.
 */
import { copyFile, cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { build } from "esbuild";

/** Must equal `dependencies` in packages/cli/package.json. Checked below. */
const RUNTIME_DEPENDENCIES = [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-tui",
	"typebox",
];

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliDir = path.join(repoRoot, "packages/cli");
const dist = path.join(cliDir, "dist");
const outfile = path.join(dist, "index.js");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const result = await build({
	entryPoints: [path.join(cliDir, "src/index.ts")],
	outfile,
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	external: RUNTIME_DEPENDENCIES,
	legalComments: "none",
	metafile: true,
	logLevel: "warning",
});

await cp(path.join(repoRoot, "profiles"), path.join(dist, "profiles"), { recursive: true });
await cp(path.join(repoRoot, "skills"), path.join(dist, "skills"), { recursive: true });
await copyFile(path.join(repoRoot, "LICENSE"), path.join(cliDir, "LICENSE"));

const failures = [];
const emitted = await readFile(outfile, "utf8");

// 1. The bin only executes with a shebang.
if (!emitted.startsWith("#!/usr/bin/env node\n")) {
	failures.push("the bundle has no shebang, so the bin will not execute");
}

// 2. Core must be inlined, not imported. A name unique to it is the proof.
for (const symbol of ["TOOL_FACTORIES", "buildSystemPrompt", "resolveProfilesDir"]) {
	if (!emitted.includes(symbol)) {
		failures.push(`core was not inlined: "${symbol}" is absent from the bundle`);
	}
}

// 3. Every remaining import must be a listed dependency or a node builtin.
//
// `builtinModules` is authoritative, and it matters because a builtin may be
// imported bare (`events`) as well as prefixed (`node:events`). Recognising
// only the prefixed form reported a Node builtin as an undeclared dependency —
// which is exactly the false alarm a check like this must not produce, because
// the next one gets ignored.
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const imported = new Set();
for (const match of emitted.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)) {
	imported.add(match[1]);
}
for (const specifier of imported) {
	if (BUILTINS.has(specifier) || specifier.startsWith(".") || specifier.startsWith("..")) {
		continue;
	}
	const root = specifier.startsWith("@")
		? specifier.split("/").slice(0, 2).join("/")
		: specifier.split("/")[0];
	if (!RUNTIME_DEPENDENCIES.includes(root)) {
		failures.push(`the bundle imports "${specifier}", which is not a declared runtime dependency`);
	}
}

// 4. The declared dependencies must match the external list, or installs break.
const manifest = JSON.parse(await readFile(path.join(cliDir, "package.json"), "utf8"));
const declared = Object.keys(manifest.dependencies ?? {}).sort();
if (declared.join(",") !== [...RUNTIME_DEPENDENCIES].sort().join(",")) {
	failures.push(
		`package.json dependencies are ${declared.join(", ") || "(none)"} but the external list is ${RUNTIME_DEPENDENCIES.join(", ")}`,
	);
}

// 5. The shipped profiles are the only ones an installed copy can reach.
const profiles = (await readdir(path.join(dist, "profiles"), { withFileTypes: true }))
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort();
if (profiles.length === 0) {
	failures.push("no profiles were copied into dist, so an installed k9999 would fail to start");
}

const bundle = await stat(outfile);
console.log(`dist/index.js    ${(bundle.size / 1024).toFixed(1)} KB`);
console.log(`bundled sources  ${Object.keys(result.metafile.inputs).length}`);
console.log(`external         ${RUNTIME_DEPENDENCIES.join(", ")}`);
console.log(`profiles         ${profiles.join(", ")}`);

if (failures.length > 0) {
	process.stderr.write("\nthe build is not publishable:\n");
	for (const failure of failures) {
		process.stderr.write(`  ${failure}\n`);
	}
	process.exit(1);
}
