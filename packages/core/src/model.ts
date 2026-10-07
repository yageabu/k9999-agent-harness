import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createModels, type Api, type Model, type MutableModels, type Provider } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { ConfigurationError } from "./errors.ts";
import type { Secret } from "./redact.ts";

/**
 * Provider registry.
 *
 * This switch is the single place where a provider name becomes an
 * implementation. Everything else in the harness addresses models by the
 * `provider/modelId` string, so adding a provider touches one function and
 * nothing else. Import the provider factory you need and add a case.
 */
function providerFactory(provider: string): Provider {
	switch (provider) {
		case "deepseek":
			return deepseekProvider();
		default:
			throw new ConfigurationError(
				`Unknown provider "${provider}". Add it to providerFactory() in packages/core/src/model.ts.`,
			);
	}
}

export interface ResolvedModel {
	models: MutableModels;
	model: Model<Api>;
	provider: string;
	id: string;
}

/**
 * The credentials this process holds, for redaction (SPEC 0011, link 1).
 *
 * Asked of the provider rather than read from `process.env` by name. The
 * provider's `resolve()` returns both the value and the variable it came from,
 * so this file does not carry a list of variable names that would drift the
 * moment a provider changes one — and there is exactly one switch in this
 * project that knows a provider's name, which is `providerFactory` below.
 *
 * Never throws. A provider that cannot resolve is one the run will fail on
 * anyway with a better message; making redaction the first thing to complain
 * would report a configuration problem as a security one.
 */
export async function resolveCredentials(provider: Provider): Promise<Secret[]> {
	const apiKeyAuth = provider.auth.apiKey;
	// A provider with only an OAuth or ambient flow has no key to redact by value.
	// There is nothing to scan for, and guessing a format is the thing this design
	// exists to avoid.
	if (apiKeyAuth === undefined) {
		return [];
	}
	const controller = new AbortController();
	try {
		const resolved = await apiKeyAuth.resolve({
			ctx: {
				env: async (name: string) => process.env[name],
				fileExists: async (file: string) => existsSync(expandHome(file)),
			},
			signal: controller.signal,
		});
		const value = resolved?.auth?.apiKey;
		if (typeof value !== "string" || value === "") {
			return [];
		}
		return [{ value, label: resolved?.source ?? `${provider.id} credential` }];
	} catch {
		return [];
	}
}

/** `AuthContext.fileExists` documents a leading `~`; a provider may pass one. */
function expandHome(file: string): string {
	return file.startsWith("~/") ? path.join(homedir(), file.slice(2)) : file;
}

/** Resolve a `provider/modelId` reference against the provider registry. */
export function resolveModel(reference: string): ResolvedModel {
	const slash = reference.indexOf("/");
	if (slash <= 0 || slash === reference.length - 1) {
		throw new ConfigurationError(`Model reference must be "provider/modelId", got ${JSON.stringify(reference)}`);
	}
	const provider = reference.slice(0, slash);
	const id = reference.slice(slash + 1);

	const models = createModels();
	models.setProvider(providerFactory(provider));

	const model = models.getModel(provider, id);
	if (!model) {
		const available = models
			.getModels(provider)
			.map((entry) => entry.id)
			.join(", ");
		throw new ConfigurationError(`Model not found: ${reference}. Available for "${provider}": ${available || "(none)"}`);
	}
	return { models, model, provider, id };
}

/** The provider implementation behind a `provider/modelId` reference. */
export function providerFor(reference: string): Provider {
	const slash = reference.indexOf("/");
	const provider = slash > 0 ? reference.slice(0, slash) : reference;
	return providerFactory(provider);
}
