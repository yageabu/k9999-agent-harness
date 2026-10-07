import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	createRegistry,
	Harness,
	type Conversation,
	type Extension,
	type Registry,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { MemoryStorage } from "@earendil-works/pi-durable";
import type { Storage } from "@earendil-works/pi-durable";
import { profileExtension } from "./extension.ts";
import { resolveCredentials, resolveModel } from "./model.ts";
import { createRedactor, type Redactor } from "./redact.ts";
import { loadProfile, resolveProfilesDir, type Profile } from "./profile.ts";
import { resolveSkills } from "./skills.ts";
import type { SkillSummary } from "./prompt.ts";
import { guardedEnv } from "./tools/guarded-env.ts";
import { DEFAULT_TOOL_ENV } from "./tools/env.ts";

/**
 * The K9999 session: a profile, on a pi-durable harness (ADR-0017).
 *
 * `createHarness` in `./harness.ts` is the old path — a `pi-agent-core` `Agent`
 * built from the same profile. Both exist right now because the terminal and the
 * evaluator are still on the old one: their rendering is built on
 * `pi-agent-core`'s event stream, and moving that is its own piece of work. The
 * web surface is on this one, which is what made K9999's profile prompt reach the
 * model for the first time — visible in the request pane, which used to say the
 * prompt arrived as sections it could not see.
 */

export interface SessionOptions {
	/** A loaded profile. Use `loadSession` to resolve one from disk. */
	profile: Profile;
	/** The directory the agent works in. */
	cwd: string;
	/** Where the conversation is stored. Defaults to memory, which persists nothing. */
	storage?: Storage;
	/** Model reference as `provider/modelId`. Defaults to the profile's, then the environment. */
	model?: string;
	/** Skills to advertise in the prompt. */
	skills?: readonly SkillSummary[];
	/** Names a tool subprocess may read. Defaults to the profile's `env`, then the allowlist. */
	toolEnv?: readonly string[];
	/** The parent environment the allowlist draws from. Defaults to `process.env`. */
	environment?: Record<string, string | undefined>;
	/** Extra extensions to install beside the profile's. */
	extensions?: readonly Extension[];
	openContext?: typeof BACKGROUND_CONTEXT;
}

export interface Session {
	harness: Harness;
	conversation: Conversation;
	registry: Registry;
	profile: Profile;
	modelRef: string;
	/** What credentials tool output is scanned for, by label. */
	redacting: readonly string[];
	/** Declared environment names the host does not have, so a profile that asked for something absent is visible. */
	envMissing: readonly string[];
	close(): Promise<void>;
}

export async function createSession(options: SessionOptions): Promise<Session> {
	const context = options.openContext ?? BACKGROUND_CONTEXT;
	const { profile, cwd } = options;

	const modelRef = options.model ?? process.env["K9999_MODEL"] ?? profile.config.model ?? "deepseek/deepseek-flash";
	const slash = modelRef.indexOf("/");
	if (slash <= 0 || slash === modelRef.length - 1) {
		throw new Error(`Model reference must be "provider/modelId", got ${JSON.stringify(modelRef)}`);
	}
	const providerId = modelRef.slice(0, slash);
	const modelId = modelRef.slice(slash + 1);

	// The credentials this process holds, asked of the provider rather than read
	// from a list of variable names that would drift. `resolveModel` is called for
	// its side effect of validating the reference before anything is opened.
	const { models } = resolveModel(modelRef);
	const provider = models.getProvider(providerId);
	const secrets = provider === undefined ? [] : await resolveCredentials(provider);
	const redactor: Redactor = createRedactor(secrets);

	const allow = options.toolEnv ?? profile.config.env ?? DEFAULT_TOOL_ENV;
	const source = options.environment ?? process.env;

	const skills = options.skills ?? [];
	const registry = createRegistry();
	registry.install(profileExtension({ profile, skills, redactor }));
	for (const extension of options.extensions ?? []) {
		registry.install(extension);
	}

	const storage = options.storage ?? new MemoryStorage();
	const harness = await Harness.open(
		storage,
		{
			models,
			registry,
			// The environment is where the allowlist lives, not the tool. A tool that
			// forgets is the case `guardedEnv` exists to make safe (SPEC 0011).
			env: ({ cwd: conversationCwd }) =>
				guardedEnv({
					inner: new NodeExecutionEnv({ cwd: conversationCwd ?? cwd }),
					source,
					allow,
				}),
		},
		context,
	);

	const conversation = await harness.root(context, {
		agent: { model: { provider: providerId, modelId }, cwd },
	});
	harness.resume();

	const missing = allow.filter((name) => {
		const found = Object.keys(source).some((key) => key.toUpperCase() === name.toUpperCase());
		return !found;
	});

	return {
		harness,
		conversation,
		registry,
		profile,
		modelRef,
		redacting: secrets.map((secret) => secret.label),
		envMissing: missing,
		close: async () => {
			await harness.close(context);
		},
	};
}

/** Resolve a profile from disk and open a session on it. */
export async function loadSession(
	options: Omit<SessionOptions, "profile"> & { profile?: string; profilesDir?: string },
): Promise<Session> {
	const dir = options.profilesDir ?? (await resolveProfilesDir(undefined, ["./profiles"]));
	const profile = await loadProfile(dir, options.profile ?? "code");
	const declared = profile.config.skills ?? [];
	const skills = declared.length > 0 ? await resolveSkills(dir, declared) : [];
	return createSession({ ...options, profile, skills });
}
