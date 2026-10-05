import path from "node:path";

/**
 * A launch name is a command that selects a profile by default.
 *
 * One implementation, two names. A name carries no behavior of its own: it
 * supplies a default profile and nothing else, which a test asserts by running
 * `kula --profile code` and `k9999 --profile code` to the same result.
 */
export interface LaunchName {
	/** The command, as typed. */
	readonly command: string;
	/** The profile it selects when `--profile` is absent. */
	readonly profileId: string;
}

export const LAUNCH_NAMES: readonly LaunchName[] = [
	{ command: "k9999", profileId: "code" },
	{ command: "kula", profileId: "data" },
];

/** Used when neither `--profile` nor a recognized launch name is present. */
export const DEFAULT_PROFILE = "code";

/**
 * The profile a launch name selects.
 *
 * The name comes from the basename of `argv[1]`. An unrecognized basename —
 * running the entry by path, as the test suite and `npm run` do — leaves the
 * default alone instead of failing, because failing there would break the suite
 * for a cosmetic reason.
 */
export function profileForLaunchName(argv1: string | undefined): string {
	if (argv1 === undefined) {
		return DEFAULT_PROFILE;
	}
	const command = path.basename(argv1).replace(/\.(?:js|mjs|cjs|ts)$/, "");
	const match = LAUNCH_NAMES.find((entry) => entry.command === command);
	return match?.profileId ?? DEFAULT_PROFILE;
}

/** The launch name that defaults to a profile, when one exists. */
export function launchNameFor(profileId: string): string | undefined {
	return LAUNCH_NAMES.find((entry) => entry.profileId === profileId)?.command;
}

/** The launch names, for help text and `--list`. */
export function launchSummary(): string {
	return LAUNCH_NAMES.map((entry) => `${entry.command} → ${entry.profileId}`).join(", ");
}
