import type { Profile } from "./profile.ts";

/** One tool as it appears in the generated prompt section. */
export interface ToolSummary {
	name: string;
	description: string;
}

/** One skill as it appears in the generated prompt section. */
export interface SkillSummary {
	name: string;
	description: string;
	path: string;
}

export interface PromptInput {
	profile: Profile;
	cwd: string;
	tools: readonly ToolSummary[];
	skills: readonly SkillSummary[];
}

/**
 * Assemble the system prompt.
 *
 * The order is the contract, and every profile gets the same one:
 *
 * 1. `profiles/<id>/system.md`, with `{{cwd}}` interpolated
 * 2. a generated `## Available tools` section
 * 3. a generated `## Skills` section, when the profile declares skills
 * 4. `Current working directory: <cwd>`
 *
 * Generated sections come after the authored text so that a profile author
 * never has to keep a tool list in sync by hand. Only step 1 is per-profile.
 */
export function buildSystemPrompt(input: PromptInput): string {
	const sections: string[] = [input.profile.system.replaceAll("{{cwd}}", input.cwd).trimEnd()];

	if (input.tools.length > 0) {
		sections.push(
			["## Available tools", "", ...input.tools.map((tool) => `- ${tool.name}: ${tool.description}`)].join("\n"),
		);
	}

	if (input.skills.length > 0) {
		sections.push(
			[
				"## Skills",
				"",
				"Read a skill's file when the task matches its description. Do not guess at a procedure a skill already describes.",
				"",
				...input.skills.map((skill) => `- ${skill.name}: ${skill.description} (${skill.path})`),
			].join("\n"),
		);
	}

	sections.push(`Current working directory: ${input.cwd}`);

	return `${sections.join("\n\n")}\n`;
}
