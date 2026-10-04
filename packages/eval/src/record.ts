import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { BudgetBreach, RunMetrics } from "./metrics.ts";

/**
 * How a run's token figures were obtained.
 *
 * The scripted provider estimates tokens from character counts and reports
 * every cost as zero. Presented without this label, an estimated figure reads
 * as authoritative, and a cost column of zeros reads as a win when it is
 * structurally zero. Comparing an estimated run against a reported one is not
 * a comparison, so the distinction travels with the data.
 */
export type UsageSource = "reported" | "estimated";

/**
 * One line of a run's transcript.
 *
 * The transcript is the run's durable form. Two things read it: `replay.ts`,
 * which re-runs the harness against the recorded model responses with no
 * network, and whoever is asking what actually happened.
 */
export type RecordEntry =
	| {
			readonly type: "run";
			readonly taskId: string;
			readonly configId: string;
			readonly modelRef: string;
			readonly startedAt: string;
			/** True when the model was scripted, which is what replay produces. */
			readonly scripted: boolean;
			/** Whether the token figures were reported by a provider or estimated. */
			readonly usageSource: UsageSource;
	  }
	| { readonly type: "assistant"; readonly index: number; readonly message: AssistantMessage }
	| {
			readonly type: "tool";
			readonly index: number;
			readonly toolCallId: string;
			readonly toolName: string;
			readonly isError: boolean;
	  }
	| { readonly type: "degrade"; readonly reason: string }
	| { readonly type: "breach"; readonly breach: BudgetBreach }
	| { readonly type: "check"; readonly ok: boolean; readonly detail: string }
	| { readonly type: "error"; readonly message: string }
	| { readonly type: "metrics"; readonly metrics: RunMetrics };

export class RecordError extends Error {
	override readonly name = "RecordError";
}

export interface RunRecord {
	readonly taskId: string;
	readonly configId: string;
	readonly modelRef: string;
	readonly scripted: boolean;
	readonly usageSource: UsageSource;
	readonly entries: readonly RecordEntry[];
	readonly metrics: RunMetrics;
}

function assertRecord(value: unknown, line: number): RecordEntry {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new RecordError(`line ${line}: expected a JSON object`);
	}
	const type = (value as Record<string, unknown>)["type"];
	if (typeof type !== "string") {
		throw new RecordError(`line ${line}: missing "type"`);
	}
	return value as RecordEntry;
}

/** Serialize a transcript as JSONL. One entry per line, so an interrupted run keeps its prefix. */
export function serializeRecord(entries: readonly RecordEntry[]): string {
	return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

export function parseRecord(text: string): RecordEntry[] {
	const entries: RecordEntry[] = [];
	const lines = text.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (line === undefined || line.trim() === "") {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			throw new RecordError(`line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
		}
		entries.push(assertRecord(parsed, index + 1));
	}
	if (entries.length === 0) {
		throw new RecordError("the transcript is empty");
	}
	return entries;
}

export async function writeRecord(file: string, entries: readonly RecordEntry[]): Promise<void> {
	await writeFile(file, serializeRecord(entries), "utf8");
}

export function summarize(entries: readonly RecordEntry[]): RunRecord {
	const run = entries.find((entry) => entry.type === "run");
	if (!run || run.type !== "run") {
		throw new RecordError("the transcript has no run header");
	}
	const metricsEntry = [...entries].reverse().find((entry) => entry.type === "metrics");
	if (!metricsEntry || metricsEntry.type !== "metrics") {
		throw new RecordError(`run ${run.taskId}/${run.configId} has no metrics entry`);
	}
	return {
		taskId: run.taskId,
		configId: run.configId,
		modelRef: run.modelRef,
		scripted: run.scripted,
		usageSource: run.usageSource,
		entries,
		metrics: metricsEntry.metrics,
	};
}

export async function readRecord(file: string): Promise<RunRecord> {
	return summarize(parseRecord(await readFile(file, "utf8")));
}

export async function readRecordDir(dir: string): Promise<RunRecord[]> {
	const { readdir } = await import("node:fs/promises");
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return [];
	}
	const records: RunRecord[] = [];
	for (const name of names.filter((entry) => entry.endsWith(".jsonl")).sort()) {
		records.push(await readRecord(path.join(dir, name)));
	}
	return records;
}

/**
 * The recorded model responses, in order, usable as a replay script.
 *
 * Replay reproduces the model and runs everything else for real. Replaying the
 * tools as well would only prove that the replay is self-consistent; executing
 * them against a fresh fixture is what shows the harness itself is
 * deterministic.
 */
export function scriptOf(record: RunRecord): AssistantMessage[] {
	return record.entries
		.filter((entry): entry is Extract<RecordEntry, { type: "assistant" }> => entry.type === "assistant")
		.sort((a, b) => a.index - b.index)
		.map((entry) => entry.message);
}
