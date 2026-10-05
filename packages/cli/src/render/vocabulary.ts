import type { FileChange } from "@k9999/core";

/**
 * Everything a running agent has accumulated, for a status or summary line.
 *
 * The agent produces this; a sink decides whether it becomes a dim line under
 * a turn, a dashboard row, or nothing at all.
 */
export interface RunState {
	readonly model: string;
	readonly cwd: string;
	readonly turns: number;
	readonly toolCalls: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly costUSD: number;
	readonly startedAt: number;
}

export function initialRunState(model: string, cwd: string): RunState {
	return {
		model,
		cwd,
		turns: 0,
		toolCalls: 0,
		inputTokens: 0,
		outputTokens: 0,
		costUSD: 0,
		startedAt: Date.now(),
	};
}

/**
 * A description of something that happened, with no idea how it will look.
 *
 * The variants at the bottom are not produced yet. They are declared because a
 * vocabulary that arrives after its consumers is a vocabulary shaped by one of
 * them: `interaction` comes from the channel work, `degrade` from the decision
 * layer, and `check` from the measurement layer. A text sink renders all three
 * plainly today, which is also the honest rendering of something not built.
 */
export type RenderItem =
	// What the model said.
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "thinking"; readonly text: string }
	// What it did.
	| { readonly kind: "toolCall"; readonly id: string; readonly name: string; readonly summary: string }
	| {
			readonly kind: "toolResult";
			readonly id: string;
			readonly name: string;
			readonly ok: boolean;
			readonly summary: string;
			readonly change?: FileChange;
	  }
	// What it cost.
	| { readonly kind: "turn"; readonly state: RunState }
	// How it ended.
	| { readonly kind: "error"; readonly message: string }
	// Not produced yet: 0001, 0003, 0004.
	| {
			readonly kind: "interaction";
			readonly id: string;
			readonly prompt: string;
			readonly deadline: string;
			readonly defaultAction: string;
	  }
	| { readonly kind: "degrade"; readonly reason: string }
	| { readonly kind: "check"; readonly ok: boolean; readonly detail: string };

/**
 * Where rendered items go.
 *
 * This is the seam a channel plugs into, and the reason the vocabulary comes
 * before any UI work. The terminal sink is one implementation; a channel, a
 * dashboard, and a test recorder are the same shape.
 */
export interface RenderSink {
	readonly name: string;
	emit(item: RenderItem): void;
	/** Called once when the run is over, with the final totals. */
	end?(state: RunState): void;
}
