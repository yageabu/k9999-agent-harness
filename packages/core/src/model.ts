import { createModels, type Api, type Model, type MutableModels, type Provider } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

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
			throw new Error(
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

/** Resolve a `provider/modelId` reference against the provider registry. */
export function resolveModel(reference: string): ResolvedModel {
	const slash = reference.indexOf("/");
	if (slash <= 0 || slash === reference.length - 1) {
		throw new Error(`Model reference must be "provider/modelId", got ${JSON.stringify(reference)}`);
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
		throw new Error(`Model not found: ${reference}. Available for "${provider}": ${available || "(none)"}`);
	}
	return { models, model, provider, id };
}
