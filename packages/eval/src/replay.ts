import type { Profile } from "@k9999/core";
import type { Budget } from "./metrics.ts";
import { scriptOf, type RunRecord } from "./record.ts";
import { type RunOptions, type RunResult, runTask } from "./runner.ts";
import type { Task } from "./task.ts";

export interface ReplayDeps {
	readonly task: Task;
	readonly profile: Profile;
	readonly budget?: Budget;
	readonly workDir?: string;
}

/**
 * Re-run a recorded transcript.
 *
 * The recorded model responses are fed to a scripted provider; the prompt, the
 * tools, and the predicate all run for real against a fresh fixture. Replaying
 * the tool results as well would only demonstrate that the replay agrees with
 * itself. Executing them is what shows the harness is deterministic.
 *
 * Requires no network and no credentials, which is what makes it usable as a
 * regression check.
 */
export async function replay(record: RunRecord, deps: ReplayDeps): Promise<RunResult> {
	const options: RunOptions = deps.workDir === undefined ? {} : { workDir: deps.workDir };
	const spec = {
		task: deps.task,
		profile: deps.profile,
		configId: record.configId,
		script: scriptOf(record),
		...(deps.budget === undefined ? {} : { budget: deps.budget }),
	};
	return await runTask(spec, options);
}
