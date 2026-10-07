import type { Context } from "@earendil-works/chord";
import type {
	ExecutionEnv,
	ExecutionError,
	Result,
	ShellExecOptions,
	ShellExecResult,
} from "@earendil-works/pi-durable/env";
import { toolEnvironment } from "./env.ts";

/**
 * An `ExecutionEnv` that enforces the tool allowlist (SPEC 0011, link 1).
 *
 * ## Why a wrapper and not an option
 *
 * `NodeExecutionEnv` takes a `shellEnv`, which looks like the place to put an
 * allowlist. It is not. Its merge is:
 *
 * ```js
 * function getShellEnv(baseEnv, extraEnv, inheritEnv = true) {
 *     if (!inheritEnv) return { ...extraEnv };
 *     return { ...process.env, ...baseEnv, ...extraEnv };
 * }
 * ```
 *
 * `process.env` is spread **underneath** `shellEnv`, so `shellEnv` is an override
 * layer and not a filter. And pi-durable's own `bash` tool passes
 * `inheritEnv: true`, so on the migrated harness the credential stayed readable —
 * measured through `NodeExecutionEnv` with the allowlist set:
 *
 * ```console
 * shellEnv + inheritEnv: true    -> 36 bytes, 48 variables   # the same leak
 * shellEnv + inheritEnv: false   ->  0 bytes,  3 variables
 * ```
 *
 * Wrapping rather than passing a flag is the stronger guarantee: it protects
 * every tool that goes through this environment, including pi-durable's own and
 * any extension added later. A tool that forgets to ask is the normal case, and
 * this is what makes forgetting safe. It is also the layer `pi-durable` intends
 * — `HarnessOptions.env` is a function from a conversation to an environment
 * precisely so policy lives there.
 *
 * ## What it does not do
 *
 * It does not redact. Redaction belongs to the tool, on the assembled result,
 * because a credential split across two `onOutput` chunks does not match the
 * value being looked for — the same failure mode as truncating before redacting,
 * which `tools/bash.ts` already avoids. An environment that redacted per chunk
 * would look like protection and miss exactly the case that matters.
 */
export interface GuardedEnvOptions {
	inner: ExecutionEnv;
	/** The parent environment the allowlist draws from. Defaults to `process.env`. */
	source?: Record<string, string | undefined>;
	/** Names the shell may read. */
	allow: readonly string[];
}

/**
 * `ExecutionEnv` is wide — readers, writers, watchers, path operations. This
 * delegates all of it and overrides exactly one member, so a method added
 * upstream is passed through rather than silently missing from the wrapper.
 */
export function guardedEnv(options: GuardedEnvOptions): ExecutionEnv {
	const { inner, allow } = options;
	const shellEnv = toolEnvironment(options.source ?? process.env, allow);

	return new Proxy(inner as unknown as object, {
		get(target, property) {
			if (property === "exec") {
				return async (
					command: string | readonly string[],
					execOptions: ShellExecOptions | undefined,
					context: Context,
				): Promise<Result<ShellExecResult, ExecutionError>> =>
					inner.exec(
						command,
						{
							...execOptions,
							// The allowlist *is* the environment. Nothing is inherited from the
							// host, and a caller asking to inherit is asking to put `process.env`
							// back — which is the defect this file exists to close.
							inheritEnv: false,
							env: { ...shellEnv, ...execOptions?.env },
						},
						context,
					);
			}
			const value = Reflect.get(target, property) as unknown;
			return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(inner) : value;
		},
	}) as ExecutionEnv;
}
