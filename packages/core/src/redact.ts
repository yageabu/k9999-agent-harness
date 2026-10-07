/**
 * Redaction of credentials from tool output (SPEC 0011, link 1, rule 3).
 *
 * This is a backstop and not the mechanism, and the distinction matters. The
 * mechanism is `toolEnvironment`, which stops the credential reaching the child
 * at all. This catches the credential that arrived some other way: a `.env` the
 * agent read, a `git config` value, a file it was told to open.
 *
 * It matches by **value**, not by pattern. A pattern looks for something that
 * resembles a key and guesses; a value is a thing this process already knows,
 * so there is nothing to guess and nothing to tune. The values come from asking
 * the provider to resolve its own credential
 * (`packages/core/src/model.ts`), which is also where the source variable name
 * comes from — so this file does not hardcode `DEEPSEEK_API_KEY`.
 */

export interface Secret {
	/** The value to remove from text. Never logged, never reported. */
	readonly value: string;
	/** What appears in place of it, so a report can say which credential was hit. */
	readonly label: string;
}

export interface Redaction {
	readonly text: string;
	/** Labels of the secrets that were found, in the order they were tried. */
	readonly hits: readonly string[];
}

export interface Redactor {
	redact(text: string): Redaction;
	/** Whether this redactor has anything to look for. */
	readonly active: boolean;
}

/**
 * A value shorter than this is not treated as a secret.
 *
 * A one-character "credential" would match nearly every tool result and destroy
 * the output the model is reasoning about. Every real provider key is far longer
 * than this; the guard exists so a misconfigured or empty value cannot turn the
 * transcript into `[redacted]`.
 */
const MIN_SECRET_LENGTH = 8;

export function createRedactor(secrets: readonly Secret[]): Redactor {
	const usable = secrets
		.filter((secret) => secret.value.length >= MIN_SECRET_LENGTH)
		// Longest first, so a value that contains another is replaced whole
		// rather than in pieces that leave the remainder legible.
		.sort((a, b) => b.value.length - a.value.length);

	return {
		active: usable.length > 0,
		redact(text: string): Redaction {
			let result = text;
			const hits: string[] = [];
			for (const secret of usable) {
				if (!result.includes(secret.value)) {
					continue;
				}
				hits.push(secret.label);
				result = result.split(secret.value).join(`[redacted: ${secret.label}]`);
			}
			return { text: result, hits };
		},
	};
}

/** A redactor that does nothing, for callers with no credentials to protect. */
export const NO_REDACTOR: Redactor = {
	active: false,
	redact: (text: string) => ({ text, hits: [] }),
};
