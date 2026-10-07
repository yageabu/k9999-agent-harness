import type { Context } from "@earendil-works/chord";
import { defineExtension, section, type Extension, type PromptInput, type ToolRegistration } from "@earendil-works/pi-durable";
import type { Profile } from "./profile.ts";
import { ConfigurationError } from "./errors.ts";
import type { SkillSummary } from "./prompt.ts";
import type { Redactor } from "./redact.ts";
import { createBashTool } from "./tools/bash.ts";
import { editTool } from "./tools/edit.ts";
import { readTool } from "./tools/read.ts";

/**
 * A profile, as a pi-durable extension.
 *
 * This is where K9999's layer meets the harness underneath it. A profile was
 * always two things — a declaration and a system prompt — and both have a home
 * here: the declaration becomes the tool list, and the prompt becomes a
 * `PromptSection`, which is how pi-durable delivers a positional prompt.
 *
 * The generated "## Available tools" section the old prompt assembly produced is
 * deliberately gone. pi-durable sends the tool schemas structurally, on the
 * request, so a prose copy of them would be the same facts in two places — and
 * the prose one is the one that drifts.
 */

export interface ProfileExtensionOptions {
	profile: Profile;
	/** Skills to advertise. Advertised, not injected: the agent reads one when the task matches. */
	skills?: readonly SkillSummary[];
	/** Removes credentials from tool output. */
	redactor?: Redactor;
}

/** The tools a profile may name, by name. */
const TOOL_BUILDERS: Record<string, (options: { redactor?: Redactor }) => ToolRegistration> = {
	read: () => readTool,
	edit: () => editTool,
	bash: (options) => (options.redactor === undefined ? createBashTool() : createBashTool({ redactor: options.redactor })),
};

export function knownTools(): string[] {
	return Object.keys(TOOL_BUILDERS);
}

export function profileExtension(options: ProfileExtensionOptions): Extension {
	const { profile, skills = [], redactor } = options;

	const missing = profile.config.tools.filter((name) => TOOL_BUILDERS[name] === undefined);
	if (missing.length > 0) {
		throw new ConfigurationError(
			`Profile "${profile.id}" names unknown tool(s): ${missing.join(", ")}. Known tools: ${knownTools().join(", ")}`,
		);
	}

	const tools = profile.config.tools.map((name) => {
		const build = TOOL_BUILDERS[name];
		if (build === undefined) {
			throw new Error(`Unknown tool "${name}"`);
		}
		return redactor === undefined ? build({}) : build({ redactor });
	});

	// Tagged false so the authored prompt arrives as written rather than wrapped in
	// `<system>...</system>`. The profile's file *is* the prompt.
	//
	// The key must match `/^[a-z][a-z0-9_-]*$/` — no dots, which is why this is
	// `k9999-profile` and not the `k9999.profile` the extension name would suggest.
	const prompt = section(
		"k9999-profile",
		(input: PromptInput, _context: Context): string => {
			const cwd = input.agent.cwd ?? process.cwd();
			const parts: string[] = [profile.system.replaceAll("{{cwd}}", cwd)];
			if (skills.length > 0) {
				parts.push(
					[
						"## Skills",
						"",
						"Read a skill's file when the task matches its description. Do not guess at a procedure a skill already describes.",
						"",
						...skills.map((skill) => `- ${skill.name}: ${skill.description} (${skill.path})`),
					].join("\n"),
				);
			}
			parts.push(`Current working directory: ${cwd}`);
			return parts.join("\n\n");
		},
		{ tag: false },
	);

	return defineExtension({
		name: `k9999.${profile.id}`,
		sections: [prompt],
		tools,
	});
}
