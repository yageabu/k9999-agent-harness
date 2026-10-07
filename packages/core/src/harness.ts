import { Agent, type AgentEvent } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { type ResolvedModel, resolveModel } from "./model.ts";
import type { Profile } from "./profile.ts";
import { buildSystemPrompt, type SkillSummary } from "./prompt.ts";
import { resolveSkills, resolveSkillsDir } from "./skills.ts";
import { type AnyTool, createTools } from "./tools/index.ts";
import { DEFAULT_TOOL_ENV, missingFromEnvironment } from "./tools/env.ts";
import { createRedactor, type Redactor, type Secret } from "./redact.ts";
import { providerFor, resolveCredentials } from "./model.ts";

/** Used when neither the caller, the environment, nor the profile names a model. */
export const DEFAULT_MODEL = "deepseek/deepseek-flash";

/** Environment variable that overrides the profile's model. */
export const MODEL_ENV = "K9999_MODEL";

export interface HarnessOptions {
	profile: Profile;
	cwd: string;
	/** Highest precedence model override, ahead of `K9999_MODEL` and the profile. */
	model?: string;
	/**
	 * Skip provider resolution and use these models directly.
	 *
	 * This is the seam tests use to drive the harness with a scripted provider
	 * instead of a real API key. When set, `model` and the profile's model are
	 * ignored for resolution but `modelRef` is still reported.
	 */
	resolvedModel?: ResolvedModel;
	/** Skills advertised in the system prompt. When omitted, `profile.config.skills` is resolved from disk. */
	skills?: readonly SkillSummary[];
	/** Directory holding `<name>/SKILL.md`. Resolved from disk only when `skills` is omitted. */
	skillsDir?: string;
	/** Extra candidate directories for skills, tried after the walk-up. For a packaged install. */
	skillsFallbacks?: readonly string[];
	/** Subscriber for every agent event. */
	onEvent?: (event: AgentEvent) => void;
	/**
	 * Credentials to remove from tool output. When omitted, they are asked of the
	 * provider named by `modelRef`, so a caller does not have to know which
	 * variable a provider reads. Pass `[]` to redact nothing, which is what a test
	 * with a scripted provider wants.
	 */
	secrets?: readonly Secret[];
	/** Names a tool subprocess may read. Defaults to the allowlist in `tools/env.ts`. */
	toolEnv?: readonly string[];
	/** The parent environment the subprocess allowlist draws from. Defaults to `process.env`. */
	environment?: Record<string, string | undefined>;
	/** A redactor to use instead of building one from `secrets`. */
	redactor?: Redactor;
}

export interface Harness {
	agent: Agent;
	profile: Profile;
	model: Model<Api>;
	/** Model reference actually used, after all overrides. */
	modelRef: string;
	systemPrompt: string;
	tools: AnyTool[];
	/**
	 * The credentials tool output is scanned for, by label. Empty means nothing
	 * is redacted, which is a state worth being able to report rather than a
	 * detail to leave implicit.
	 */
	redacting: readonly string[];
	/**
	 * Declared environment names the host does not have, so a profile that asked
	 * for something absent is visible instead of looking configured.
	 */
	envMissing: readonly string[];
	/**
	 * The skills the prompt advertises, resolved from disk.
	 *
	 * Returned rather than left inside `systemPrompt` because a surface that
	 * reports what loaded has to name them, and re-resolving them there would
	 * be a second answer to a question already answered.
	 */
	skills: readonly SkillSummary[];
}

/**
 * Assemble a runnable agent from one profile.
 *
 * Everything arrives here and nothing else does: the profile supplies the
 * prompt and the tool list, this function resolves the model, builds the tools
 * against the working directory, and hands the result to a single `Agent`.
 */
export async function createHarness(options: HarnessOptions): Promise<Harness> {
	const { profile, cwd } = options;

	const modelRef = options.model ?? process.env[MODEL_ENV] ?? profile.config.model ?? DEFAULT_MODEL;
	const { models, model } = options.resolvedModel ?? resolveModel(modelRef);

	// What the tools may read, and what is scanned for on the way out. Both are
	// resolved once: the allowlist is a decision and the credential list is a
	// fact about this process, and neither should be re-derived per call where a
	// value the model can reach might influence it.
	const source = options.environment ?? process.env;
	const allow = options.toolEnv ?? profile.config.env ?? DEFAULT_TOOL_ENV;
	const secrets = options.secrets ?? (await resolveCredentials(providerFor(modelRef)));
	const redactor = options.redactor ?? createRedactor(secrets);

	const tools = createTools(profile.config.tools, cwd, { env: allow, source, redactor });

	let skills = options.skills ?? [];
	if (options.skills === undefined) {
		const declared = profile.config.skills ?? [];
		if (declared.length > 0) {
			skills = await resolveSkills(await resolveSkillsDir(options.skillsDir, options.skillsFallbacks), declared);
		}
	}

	const systemPrompt = buildSystemPrompt({
		profile,
		cwd,
		tools: tools.map((tool) => ({ name: tool.name, description: tool.description })),
		skills,
	});

	const agent = new Agent({
		initialState: {
			systemPrompt,
			model,
			tools,
			...(profile.config.thinkingLevel === undefined ? {} : { thinkingLevel: profile.config.thinkingLevel }),
		},
		streamFn: models.streamSimple.bind(models),
	});

	if (options.onEvent) {
		agent.subscribe(options.onEvent);
	}

	return {
		agent,
		profile,
		model,
		modelRef,
		systemPrompt,
		tools,
		skills,
		redacting: secrets.map((secret) => secret.label),
		envMissing: missingFromEnvironment(source, allow),
	};
}
