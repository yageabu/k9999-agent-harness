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
import { bannerLines, StatusHeader } from "./header.ts";
import { createTuiTheme, type TuiTheme } from "./theme.ts";
import { TranscriptView } from "./transcript.ts";

/**
 * Rows the header, the editor, and the status line occupy.
 *
 * The transcript fits itself to `rows - chrome` because a VStack does not
 * allocate height: it stacks each child at its natural size. Getting this wrong
 * shows up as the bottom of the screen scrolling away.
 */
const CHROME_ROWS = 7;

export interface SessionFacts {
	readonly version: string;
	readonly profile: string;
	readonly cwd: string;
	readonly model: string;
	readonly modelName: string;
	readonly provider: string;
	readonly thinking: string;
	readonly contextWindow: number;
	/** Read from the agent, which owns the session. The render layer has no view of it. */
	readonly contextTokens: () => number;
	readonly color?: ColorMode;
}

export interface TuiAppOptions {
	/** Injected by tests. Defaults to a real terminal. */
	readonly terminal?: Terminal;
	readonly facts: SessionFacts;
	/** Called with the editor's text on submit. The promise is awaited before the next prompt. */
	readonly onSubmit: (text: string) => Promise<void>;
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
 * The interactive transcript TUI: a status header, scrollback, and a multi-line
 * editor.
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

	const header = new StatusHeader(state, theme.styler);
	const transcript = new TranscriptView({
		style: lineStyle(theme.styler, facts.cwd, options.maxDiffLines ?? 24),
		budget: () => Math.max(4, terminal.rows - CHROME_ROWS),
		onTurn: (next: RunState) => header.setState(next),
	});
	const editor = new Editor(tui, theme.editor, { paddingX: 1 });

	transcript.appendLines(
		bannerLines(
			{
				version: facts.version,
				profile: facts.profile,
				model: facts.model,
				thinking: facts.thinking,
				cwd: facts.cwd,
			},
			theme.styler,
			terminal.columns,
		),
	);

	const root = new VStack([header, transcript, editor], { gap: 0 });
	tui.addChild(root);
	// Without focus the editor never sees a keystroke. The TUI does not pick a
	// focusable child on its own.
	tui.setFocus(editor);

	editor.onSubmit = (text: string): void => {
		const trimmed = text.trim();
		if (trimmed === "") {
			return;
		}
		if (trimmed === "/exit" || trimmed === "/quit") {
			options.onExit();
			return;
		}
		void options.onSubmit(trimmed).catch((error: unknown) => {
			transcript.append({
				kind: "error",
				message: error instanceof Error ? error.message : String(error),
			});
			tui.requestRender();
		});
	};

	const sink: RenderSink = {
		name: "tui",
		emit(item: RenderItem): void {
			transcript.append(item);
			tui.requestRender();
		},
		end(state: RunState): void {
			transcript.end(state);
			header.setState(state);
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
