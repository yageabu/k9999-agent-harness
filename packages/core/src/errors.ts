/**
 * A mistake in configuration, not a defect in the harness.
 *
 * The distinction changes what the command line prints. A configuration problem
 * gets its message; anything else gets a stack trace. A stack for a typo in a
 * JSON file teaches nothing and buries the one line that would help:
 *
 *     Unknown tool "reed". Known tools: read, bash, edit
 *
 * That line is the whole answer, and it was four lines down a traceback.
 */
export class ConfigurationError extends Error {
	// Declared as `string` rather than the literal, so a subclass can name itself
	// without narrowing the base out from under it.
	override readonly name: string = "ConfigurationError";
}
