import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { ConfigurationError } from "./errors.ts";
import type { SkillSummary } from "./prompt.ts";

export class SkillError extends ConfigurationError {
	override readonly name = "SkillError";
}

async function isDirectory(target: string): Promise<boolean> {
	try {
		return (await stat(target)).isDirectory();
	} catch {
		return false;
	}
}

/** Same resolution order as profiles: explicit path, `K9999_SKILLS`, the nearest `skills`, then the fallbacks. */
export async function resolveSkillsDir(explicit?: string, fallbacks: readonly string[] = []): Promise<string> {
	const requested = explicit ?? process.env["K9999_SKILLS"];
	if (requested !== undefined && requested !== "") {
		const resolved = path.resolve(requested);
		if (await isDirectory(resolved)) {
			return resolved;
		}
		throw new SkillError(`Skills directory not found: ${resolved}`);
	}

	let dir = process.cwd();
	for (;;) {
		const candidate = path.join(dir, "skills");
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
	throw new SkillError(
		`No skills directory at or above ${process.cwd()}${searched}. Pass skillsDir or set K9999_SKILLS.`,
	);
}

/** Skill directory names available in a skills directory, sorted. */
export async function listSkills(skillsDir: string): Promise<string[]> {
	const entries = await readdir(skillsDir, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
		.map((entry) => entry.name)
		.sort();
}

/**
 * Pull the one-line description out of a SKILL.md.
 *
 * Three accepted forms, in order: frontmatter `description:`, a bare
 * `description:` line, then the first non-empty line that is not a Markdown
 * heading. A skill with none of these is an error, because a skill with no
 * description cannot be advertised usefully.
 */
export function parseSkillDescription(content: string): string | undefined {
	const lines = content.split("\n");
	let index = 0;

	if (lines[0]?.trim() === "---") {
		for (index = 1; index < lines.length; index += 1) {
			const line = lines[index];
			if (line === undefined) {
				break;
			}
			if (line.trim() === "---") {
				index += 1;
				break;
			}
			const match = /^description\s*:\s*(.+)$/.exec(line);
			if (match?.[1] !== undefined) {
				return match[1].trim().replace(/^["']|["']$/g, "");
			}
		}
	}

	for (; index < lines.length; index += 1) {
		const line = lines[index]?.trim() ?? "";
		if (line === "" || line.startsWith("#") || line.startsWith("---")) {
			continue;
		}
		const bare = /^description\s*:\s*(.+)$/.exec(line);
		if (bare?.[1] !== undefined) {
			return bare[1].trim().replace(/^["']|["']$/g, "");
		}
		return line;
	}
	return undefined;
}

/**
 * Resolve declared skill names to summaries.
 *
 * An undeclared name is not consulted. A declared name with no `SKILL.md` is an
 * error: a profile that advertises a skill it does not ship is misconfigured.
 */
export async function resolveSkills(skillsDir: string, names: readonly string[]): Promise<SkillSummary[]> {
	const summaries: SkillSummary[] = [];
	for (const name of names) {
		const file = path.join(skillsDir, name, "SKILL.md");
		const content = await readFile(file, "utf8").catch(() => {
			throw new SkillError(`${file}: missing. Remove "${name}" from the profile or add the file.`);
		});
		const description = parseSkillDescription(content);
		if (description === undefined) {
			throw new SkillError(`${file}: no description. Add frontmatter "description:" or a first paragraph.`);
		}
		summaries.push({ name, description, path: file });
	}
	return summaries;
}
