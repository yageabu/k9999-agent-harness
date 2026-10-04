import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { loadProfile, type Profile } from "@k9999/core";

/**
 * One configuration to measure.
 *
 * A configuration is a profile plus overrides. Overrides exist so an
 * optimisation can be stated as data and compared against the profile it
 * changes, rather than argued about.
 */
export interface Config {
	readonly id: string;
	readonly description: string;
	readonly profileId: string;
	/** Replace the profile's tool list. Measures what removing a capability costs. */
	readonly tools?: readonly string[];
	readonly thinkingLevel?: ThinkingLevel;
	readonly model?: string;
	/** The configuration every delta is measured against. Exactly one should set this. */
	readonly baseline?: boolean;
}

export class ConfigError extends Error {
	override readonly name = "ConfigError";
}

export const CONFIGS: readonly Config[] = [
	{
		id: "code",
		description: "the code profile as shipped",
		profileId: "code",
		baseline: true,
	},
	{
		id: "code-no-edit",
		description: "same profile with the edit tool removed, to price the capability",
		profileId: "code",
		tools: ["read", "bash"],
	},
];

export function findConfig(id: string): Config {
	const config = CONFIGS.find((candidate) => candidate.id === id);
	if (!config) {
		throw new ConfigError(`Unknown config "${id}". Known configs: ${CONFIGS.map((c) => c.id).join(", ")}`);
	}
	return config;
}

export function baselineConfig(): Config {
	const config = CONFIGS.find((candidate) => candidate.baseline);
	if (!config) {
		throw new ConfigError("No config is marked baseline");
	}
	return config;
}

/** Apply a configuration's overrides to its profile. */
export async function profileFor(config: Config, profilesDir: string): Promise<Profile> {
	const profile = await loadProfile(profilesDir, config.profileId);
	return {
		...profile,
		config: {
			...profile.config,
			...(config.tools === undefined ? {} : { tools: [...config.tools] }),
			...(config.thinkingLevel === undefined ? {} : { thinkingLevel: config.thinkingLevel }),
			...(config.model === undefined ? {} : { model: config.model }),
		},
	};
}

/**
 * Whether two configurations present the same tool surface.
 *
 * A recorded model transcript is a recording of the model, not of the harness.
 * Replaying one under a configuration with a different tool set feeds the agent
 * calls to tools it does not have, so the numbers describe an error path rather
 * than the configuration. Comparing tool sets needs a real model.
 */
export async function sameToolSurface(left: Config, right: Config, profilesDir: string): Promise<boolean> {
	const [a, b] = await Promise.all([profileFor(left, profilesDir), profileFor(right, profilesDir)]);
	if (a.config.tools.length !== b.config.tools.length) {
		return false;
	}
	return a.config.tools.every((tool, index) => tool === b.config.tools[index]);
}
