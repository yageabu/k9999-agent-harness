import {
	Editor,
	ProcessTerminal,
	type Terminal,
	TuiMainScreen,
	VStack,
} from "@earendil-works/pi-tui";
import { lineStyle } from "../render/layout.ts";
import type { ColorMode } from "../render/format.ts";
import { initialRunState, type RenderItem, type RenderSink, type RunState } from "../render/vocabulary.ts";
import { Footer } from "./footer.ts";
import { readGitBranch } from "./git.ts";
import { isClear, isExit, isExitCommand, isExpand, isInterrupt } from "./keys.ts";
import { StartupHeader, type SkillFact, type StartupFacts, type ToolFact } from "./startup.ts";
import { createTuiTheme, type TuiTheme } from "./theme.ts";
import { TranscriptView } from "./transcript.ts";

/**
 * Rows the editor and the footer occupy.
 *
 * The transcript fits itself to `rows - chrome` because a VStack does not
 * allocate height: it stacks each child at its natural size. Getting this wrong
 * shows up as the bottom of the screen scrolling away.
 *
 * The editor is its two borders plus one line of input, and the footer is the
 * location line and the totals line.
 */
const CHROME_ROWS = 5;

/** How long a second `ctrl+c` waits before it counts as a new clear. */
const DOUBLE_CLEAR_MS = 500;

export interface SessionFacts {
	/** The command that was typed: `k9999` or `kula`. */
	readonly appName: string;
	readonly version: string;
	readonly profileId: string;
	readonly profileName: string;
	readonly profileDir: string;
	readonly cwd: string;
	readonly model: string;
	readonly modelName: string;
	readonly provider: string;
	readonly thinking: string;
	readonly contextWindow: number;
	/** Read from the agent, which owns the session. The render layer has no view of it. */
	readonly contextTokens: () => number;
	readonly tools: readonly ToolFact[];
	readonly skills: readonly SkillFact[];
	readonly home?: string;
	readonly color?: ColorMode;
}

export interface TuiAppOptions {
	/** Injected by tests. Defaults to a real terminal. */
	readonly terminal?: Terminal;
	readonly facts: SessionFacts;
	/** Called with the editor's text on submit. The promise is awaited before the next prompt. */
	readonly onSubmit: (text: string) => Promise<void>;
	/** Stop the turn that is running. Called only when one is. */
	readonly onInterrupt?: () => void;
	readonly onExit: () => void;
	/** Diff lines shown per change. */
	readonly maxDiffLines?: number;
}

export interface TuiApp {
	readonly sink: RenderSink;
	start(): void;
	stop(): void;
}

/**
 * The interactive transcript TUI: a startup block, scrollback, a multi-line
 * editor, and a footer.
 *
 * Main-screen rather than alt-screen, so the transcript lands in the terminal's
 * scrollback and can still be read after the process exits.
 */
export function createTuiApp(options: TuiAppOptions): TuiApp {
	const { facts } = options;
	const terminal = options.terminal ?? new ProcessTerminal();
	const theme = createTuiTheme(facts.color ?? "auto");
	const tui = new TuiMainScreen(terminal, false);

	const state = initialRunState({
		model: facts.model,
		modelName: facts.modelName,
		provider: facts.provider,
		thinking: facts.thinking,
		cwd: facts.cwd,
		contextWindow: facts.contextWindow,
	});

	const startupFacts: StartupFacts = {
		appName: facts.appName,
		version: facts.version,
		profileId: facts.profileId,
		profileName: facts.profileName,
		profileDir: facts.profileDir,
		model: facts.model,
		thinking: facts.thinking,
		tools: facts.tools,
		skills: facts.skills,
		...(facts.home === undefined ? {} : { home: facts.home }),
	};
	const budgetLines = (): number => Math.max(4, terminal.rows - CHROME_ROWS);
	const startup = new StartupHeader(startupFacts, theme.styler, { budget: budgetLines });

	// The branch is read again after each turn, so a branch created during the
	// session replaces the one the session started on.
	let branch = readGitBranch(facts.cwd);
	const footer = new Footer({
		state,
		style: theme.styler,
		branch: () => branch,
		...(facts.home === undefined ? {} : { home: facts.home }),
	});

	const transcript = new TranscriptView({
		style: lineStyle(theme.styler, facts.cwd, options.maxDiffLines ?? 24),
		budget: budgetLines,
		leading: startup,
		onTurn: (next: RunState) => {
			branch = readGitBranch(facts.cwd);
			footer.setState(next);
		},
	});
	const editor = new Editor(tui, theme.editor, { paddingX: 1 });

	const root = new VStack([transcript, editor, footer], { gap: 0 });
	tui.addChild(root);
	// Without focus the editor never sees a keystroke. The TUI does not pick a
	// focusable child on its own.
	tui.setFocus(editor);

	let running = false;
	/** Set by `escape`, so the abort that follows is not reported as a failure. */
	let interrupted = false;
	let lastClear = 0;

	tui.addInputListener((data) => {
		if (isExpand(data)) {
			startup.toggle();
			tui.requestRender();
			return { consume: true };
		}
		if (isInterrupt(data)) {
			if (running) {
				interrupted = true;
				options.onInterrupt?.();
			}
			return { consume: true };
		}
		if (isClear(data)) {
			const now = Date.now();
			if (now - lastClear < DOUBLE_CLEAR_MS) {
				options.onExit();
				return { consume: true };
			}
			lastClear = now;
			editor.setText("");
			tui.requestRender();
			return { consume: true };
		}
		if (isExit(data) && editor.getText() === "") {
			options.onExit();
			return { consume: true };
		}
		return undefined;
	});

	editor.onSubmit = (text: string): void => {
		const trimmed = text.trim();
		if (trimmed === "") {
			return;
		}
		if (isExitCommand(trimmed)) {
			options.onExit();
			return;
		}
		running = true;
		void options.onSubmit(trimmed)
			.catch((error: unknown) => {
				// An interrupt is the user stopping their own turn. Reporting it as
				// an error would make a deliberate action look like a defect.
				if (interrupted) {
					return;
				}
				transcript.append({
					kind: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			})
			.finally(() => {
				running = false;
				interrupted = false;
				tui.requestRender();
			});
	};

	const sink: RenderSink = {
		name: "tui",
		emit(item: RenderItem): void {
			transcript.append(item);
			tui.requestRender();
		},
		end(next: RunState): void {
			branch = readGitBranch(facts.cwd);
			transcript.end(next);
			footer.setState(next);
			tui.requestRender();
		},
	};

	return {
		sink,
		start(): void {
			tui.start();
		},
		stop(): void {
			tui.stop();
		},
	};
}

export type { TuiTheme };
