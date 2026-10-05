import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { ConfigurationError } from "./errors.ts";

/** Thinking levels accepted by the agent runtime, in increasing effort order. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const THINKING_LEVEL_SET: ReadonlySet<string> = new Set(THINKING_LEVELS);

/** Everything a profile declares in `profile.json`. */
export interface ProfileConfig {
	/** Display name for logs and the UI. */
	name: string;
	/** Model reference as `provider/modelId`, for example `deepseek/deepseek-chat`. */
	model?: string;
	/** Default thinking level for this profile. */
	thinkingLevel?: ThinkingLevel;
	/** Tool names this profile may call. An unknown name fails the load. */
	tools: string[];
	/** Skill directory names under `<repo>/skills`. */
	skills?: string[];
}

/** A loaded profile: its declaration plus the authored system prompt. */
export interface Profile {
	id: string;
	dir: string;
	config: ProfileConfig;
	/** Contents of `system.md`, with `{{cwd}}` left for prompt assembly. */
	system: string;
}

export class ProfileError extends ConfigurationError {
	override readonly name = "ProfileError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function isDirectory(target: string): Promise<boolean> {
	try {
		return (await stat(target)).isDirectory();
	} catch {
		return false;
	}
}

function parseProfileConfig(raw: unknown, file: string): ProfileConfig {
	if (!isRecord(raw)) {
		throw new ProfileError(`${file}: expected a JSON object`);
	}
	const id = path.basename(path.dirname(file));
	const name = raw["name"];
	if (typeof name !== "string" || name.trim() === "") {
		throw new ProfileError(`${file}: "name" must be a non-empty string`);
	}
	const tools = raw["tools"];
	if (!Array.isArray(tools) || tools.some((entry) => typeof entry !== "string")) {
		throw new ProfileError(`${file}: "tools" must be an array of strings`);
	}
	const config: ProfileConfig = { name, tools: tools as string[] };

	const model = raw["model"];
	if (model !== undefined) {
		if (typeof model !== "string" || !model.includes("/")) {
			throw new ProfileError(`${file}: "model" must be "provider/modelId"`);
		}
		config.model = model;
	}

	const thinkingLevel = raw["thinkingLevel"];
	if (thinkingLevel !== undefined) {
		if (typeof thinkingLevel !== "string" || !THINKING_LEVEL_SET.has(thinkingLevel)) {
			throw new ProfileError(
				`${file}: "thinkingLevel" must be one of ${THINKING_LEVELS.join(", ")} (got ${JSON.stringify(thinkingLevel)})`,
			);
		}
		config.thinkingLevel = thinkingLevel as ThinkingLevel;
	}

	const skills = raw["skills"];
	if (skills !== undefined) {
		if (!Array.isArray(skills) || skills.some((entry) => typeof entry !== "string")) {
			throw new ProfileError(`${file}: "skills" must be an array of strings`);
		}
		config.skills = skills as string[];
	}

	void id;
	return config;
}

/**
 * Resolve the profiles directory.
 *
 * Order: an explicit path, then `K9999_PROFILES`, then the nearest `profiles`
 * directory at or above the working directory, then each fallback in turn.
 *
 * The fallbacks exist for the published package. An installed `k9999` runs in
 * someone else's project directory, which has no `profiles/` above it, so the
 * only usable copy is the one shipped inside the package. A project that does
 * provide one still wins, because the walk-up comes first.
 */
export async function resolveProfilesDir(explicit?: string, fallbacks: readonly string[] = []): Promise<string> {
	const requested = explicit ?? process.env["K9999_PROFILES"];
	if (requested !== undefined && requested !== "") {
		const resolved = path.resolve(requested);
		if (await isDirectory(resolved)) {
			return resolved;
		}
		throw new ProfileError(`Profiles directory not found: ${resolved}`);
	}

	let dir = process.cwd();
	for (;;) {
		const candidate = path.join(dir, "profiles");
		if (await isDirectory(candidate)) {
			return candidate;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}

	for (const fallback of fallbacks) {
		if (await isDirectory(fallback)) {
			return path.resolve(fallback);
		}
	}

	const searched = fallbacks.length === 0 ? "" : `, or at ${fallbacks.join(" or ")}`;
	throw new ProfileError(
		`No profiles directory at or above ${process.cwd()}${searched}. Pass --profiles or set K9999_PROFILES.`,
	);
}

/** Profile ids available in a profiles directory, sorted for stable output. */
export async function listProfiles(profilesDir: string): Promise<string[]> {
	const entries = await readdir(profilesDir, { withFileTypes: true });
	const ids: string[] = [];
	for (const entry of entries) {
		if (entry.isDirectory() && !entry.name.startsWith(".")) {
			ids.push(entry.name);
		}
	}
	return ids.sort();
}

/** Load one profile. Both `profile.json` and `system.md` are required. */
export async function loadProfile(profilesDir: string, id: string): Promise<Profile> {
	const dir = path.join(profilesDir, id);
	if (!(await isDirectory(dir))) {
		const available = await listProfiles(profilesDir);
		throw new ProfileError(`Unknown profile "${id}". Available: ${available.join(", ") || "(none)"}`);
	}
	const configFile = path.join(dir, "profile.json");
	const systemFile = path.join(dir, "system.md");

	let config: ProfileConfig;
	try {
		config = parseProfileConfig(JSON.parse(await readFile(configFile, "utf8")), configFile);
	} catch (error) {
		if (error instanceof ProfileError) {
			throw error;
		}
		throw new ProfileError(`${configFile}: ${error instanceof Error ? error.message : String(error)}`);
	}

	let system: string;
	try {
		system = await readFile(systemFile, "utf8");
	} catch {
		throw new ProfileError(`${systemFile}: missing. Every profile needs a system prompt.`);
	}
	if (system.trim() === "") {
		throw new ProfileError(`${systemFile}: is empty`);
	}

	return { id, dir, config, system };
}
