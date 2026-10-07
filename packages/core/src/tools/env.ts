/**
 * The environment a tool subprocess receives (SPEC 0011, link 1).
 *
 * The bash tool used to spawn with no `env` option, which hands the child the
 * entire process environment. Measured on this repository: 49 variables, and
 * `printenv DEEPSEEK_API_KEY | wc -c` returns 36 — the provider credential, in
 * a tool result, which becomes a committed entry and is sent to the provider on
 * every later turn of the session.
 *
 * The fix is an allowlist rather than a denylist, and the distinction is the
 * whole point: a denylist names what is forbidden and therefore grants whatever
 * someone adds to the host environment later. A credential introduced next month
 * is protected by this file without anyone remembering to protect it.
 */

/**
 * What a subprocess gets when a profile does not say otherwise.
 *
 * Deliberately short. Every name here is a name every tool subprocess can read,
 * so the list is a decision that has to be argued for rather than extended by
 * default. `PATH` and `HOME` are what a shell needs to find a program and for
 * `git` and `npm` to read their own configuration; the rest are locale and
 * terminal basics without which output is mangled in ways that look like
 * defects.
 *
 * `SSH_AUTH_SOCK` is **not** here on purpose. It is what `git push` over SSH
 * needs, and it is also a live socket to the user's keys. A profile that needs
 * it declares it, which makes granting it a line someone reviewed.
 */
export const DEFAULT_TOOL_ENV: readonly string[] = [
	"PATH",
	"HOME",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TZ",
	"TERM",
	"USER",
	"LOGNAME",
	"SHELL",
	"TMPDIR",
];

/**
 * Build a subprocess environment from `source`, keeping only allowed names.
 *
 * The name comparison is case-insensitive and the stored key keeps the source's
 * casing, because Windows spells the same variable `Path`, `PATH`, or `path`
 * depending on who set it, and Node looks for the last one it finds. Comparing
 * exactly would drop `PATH` on a machine that spells it `Path`, and a shell with
 * no `PATH` fails in a way that reads as a broken tool.
 */
export function toolEnvironment(
	source: Record<string, string | undefined>,
	allow: readonly string[] = DEFAULT_TOOL_ENV,
): Record<string, string> {
	const wanted = new Set(allow.map((name) => name.toUpperCase()));
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(source)) {
		if (value !== undefined && wanted.has(name.toUpperCase())) {
			result[name] = value;
		}
	}
	return result;
}

/**
 * Names a profile asked for that the host does not have, so the profile can say
 * so rather than granting nothing and looking configured.
 */
export function missingFromEnvironment(
	source: Record<string, string | undefined>,
	allow: readonly string[],
): string[] {
	return allow.filter((name) => {
		const found = Object.keys(source).some((key) => key.toUpperCase() === name.toUpperCase());
		return !found;
	});
}
