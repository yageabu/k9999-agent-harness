import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** The package this binary is. */
const PACKAGE = "k9999";

export interface Report {
	readonly current: string;
	readonly registry: string;
	/** `undefined` when the registry could not be reached or did not answer usefully. */
	readonly latest: string | undefined;
	readonly problem: string | undefined;
}

/**
 * The version of the running copy.
 *
 * Read from the manifest beside the bundle rather than compiled in, so it can
 * never disagree with what was installed. `dist/index.js` and `src/index.ts`
 * are both one level below the manifest, so the same relative path works in
 * both.
 */
export async function currentVersion(): Promise<string> {
	const manifest = JSON.parse(await readFile(path.join(import.meta.dirname, "..", "package.json"), "utf8")) as {
		version?: string;
	};
	return manifest.version ?? "0.0.0";
}

/**
 * The registry the printed install command would actually use.
 *
 * Asking npm rather than assuming npmjs, because on a machine with a mirror the
 * two disagree — and the number that matters is the one `npm i -g` would see.
 * A mirror also lags, which is worth showing rather than hiding.
 */
export function configuredRegistry(): string {
	const fromEnv = process.env["npm_config_registry"];
	if (fromEnv !== undefined && fromEnv !== "") {
		return fromEnv;
	}
	const result = spawnSync("npm", ["config", "get", "registry"], { encoding: "utf8" });
	const value = result.status === 0 ? result.stdout.trim() : "";
	return value === "" ? "https://registry.npmjs.org" : value;
}

export interface CheckOptions {
	readonly current: string;
	readonly registry: string;
	/** Injected by tests. */
	readonly fetchImpl?: typeof fetch;
	readonly timeoutMs?: number;
}

export async function check(options: CheckOptions): Promise<Report> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const url = `${options.registry.replace(/\/$/, "")}/${PACKAGE}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
	try {
		const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: "application/json" } });
		if (!response.ok) {
			return { current: options.current, registry: options.registry, latest: undefined, problem: `${url} answered ${response.status}` };
		}
		const body = (await response.json()) as { "dist-tags"?: Record<string, string> };
		const latest = body["dist-tags"]?.["latest"];
		if (typeof latest !== "string" || latest === "") {
			return { current: options.current, registry: options.registry, latest: undefined, problem: `${url} has no latest tag` };
		}
		return { current: options.current, registry: options.registry, latest, problem: undefined };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { current: options.current, registry: options.registry, latest: undefined, problem: `${url}: ${reason}` };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Which of the two versions is newer.
 *
 * Enough of semver to be right about the cases a `latest` tag can produce: a
 * numeric component comparison, and a release outranking a prerelease of the
 * same core. A naive numeric parse gets the second one backwards, because it
 * reads `rc` as zero and then `0.2.0-rc.1` looks larger than `0.2.0`.
 */
export function isNewer(latest: string, current: string): boolean {
	const split = (value: string): { core: number[]; prerelease: string | undefined } => {
		const [core = "", ...rest] = value.split("-");
		return {
			core: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
			prerelease: rest.length > 0 ? rest.join("-") : undefined,
		};
	};

	const left = split(latest);
	const right = split(current);
	for (let index = 0; index < Math.max(left.core.length, right.core.length); index += 1) {
		const a = left.core[index] ?? 0;
		const b = right.core[index] ?? 0;
		if (a !== b) {
			return a > b;
		}
	}

	// Same core. A release outranks a prerelease; two prereleases are not
	// ordered, because nothing here needs to order them.
	if (left.prerelease === undefined) {
		return right.prerelease !== undefined;
	}
	return false;
}

export function render(report: Report): string[] {
	const lines = [`  current    ${report.current}`, `  registry   ${report.registry}`];

	if (report.latest === undefined) {
		lines.push(`  latest     unknown`, `  Could not check: ${report.problem}`);
		lines.push(`  To update anyway: npm i -g ${PACKAGE}@latest`);
		return lines;
	}

	lines.push(`  latest     ${report.latest}`);

	if (isNewer(report.latest, report.current)) {
		lines.push(``, `  Update with:`, `    npm i -g ${PACKAGE}@latest`);
		return lines;
	}

	if (report.latest === report.current) {
		lines.push(``, `  You are up to date.`);
		return lines;
	}

	// The running copy is newer than anything published: a build from source, or a
	// version installed before this command could see it. "You are up to date"
	// would be true and misleading, which is worse than being wrong.
	lines.push(``, `  This copy is ahead of the published release.`);
	if (!isNewer(report.current, report.latest)) {
		// Neither is greater, so they differ only in a way nothing here orders.
		lines.push(`  The two are not the same version, and neither is greater.`);
	}
	return lines;
}

/**
 * Why the flags someone arriving from Pi would reach for do not apply.
 *
 * They are answered rather than rejected, because "Unknown option" teaches
 * nothing and this is the first command a Pi user types.
 */
export const PI_FLAGS: Record<string, string> = {
	"--extensions": `${PACKAGE} has no installed packages to update. That is a decision, not a gap: installing a plugin beside the harness is the thing this project does not do (ADR-0001).`,
	"--models": `Model catalogues arrive with @earendil-works/pi-ai, so they move with the dependency. "npm update" refreshes them within this release; the update above installs a newer one.`,
	"--all": `There is nothing besides ${PACKAGE} to update, so --all and --self are the same thing.`,
	"--self": `Updating ${PACKAGE} is the only thing this command does, so --self is the default.`,
};
