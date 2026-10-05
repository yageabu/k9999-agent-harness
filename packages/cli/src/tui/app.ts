import {
	Editor,
	ProcessTerminal,
	type Component,
	type Terminal,
	TuiMainScreen,
	VStack,
} from "@earendil-works/pi-tui";
import { lineStyle } from "../render/layout.ts";
import type { ColorMode } from "../render/format.ts";
import type { RenderItem, RenderSink, RunState } from "../render/vocabulary.ts";
import { createTuiTheme, type TuiTheme } from "./theme.ts";
import { TranscriptView } from "./transcript.ts";

/**
 * Rows the editor, the status bar, and the blank lines between them occupy.
 *
 * The transcript fits itself to `rows - chrome` because a VStack does not
 * allocate height: it stacks each child at its natural size. Getting this wrong
 * shows up as the bottom of the screen scrolling away.
 */
const CHROME_ROWS = 4;

/**
 * The status bar: what the agent is doing, in one line under the editor.
 *
 * This is the smallest honest version of the dashboard. It shows the four
 * numbers a session is judged by, and nothing else, because a line is all the
 * room there is until the full-screen panel exists.
 */
class StatusBar implements Component {
	private state: RunState | undefined;
	private message = "";
	private readonly theme: TuiTheme;
	private readonly hint: string;

	// Explicit fields and assignment rather than parameter properties: Node's
	// strip-only TypeScript mode removes types without generating code, so
	// `constructor(private readonly x)` is a syntax error at runtime.
	constructor(theme: TuiTheme, hint: string) {
		this.theme = theme;
		this.hint = hint;
	}

	setState(state: RunState): void {
		this.state = state;
	}

	setMessage(message: string): void {
		this.message = message;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const s = this.theme.styler;
		const left = this.state
			? `${this.state.model}  ${this.state.turns}t  ${this.state.toolCalls}tools`
			: this.hint;
		const right = this.message;
		const gap = Math.max(1, width - left.length - right.length);
		return [`${s("dim")(left)}${" ".repeat(gap)}${s("red")(right)}`.slice(0, Math.max(1, width))];
	}
}

export interface TuiAppOptions {
	/** Injected by tests. Defaults to a real terminal. */
	readonly terminal?: Terminal;
	readonly color?: ColorMode;
	readonly cwd: string;
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
 * The interactive transcript TUI: scrollback, a multi-line editor, and a status
 * line.
 *
 * Main-screen rather than alt-screen, so the transcript lands in the terminal's
 * scrollback and can still be read after the process exits.
 */
export function createTuiApp(options: TuiAppOptions): TuiApp {
	const terminal = options.terminal ?? new ProcessTerminal();
	const theme = createTuiTheme(options.color ?? "auto");
	const tui = new TuiMainScreen(terminal, false);

	const transcript = new TranscriptView({
		style: lineStyle(theme.styler, options.cwd, options.maxDiffLines ?? 24),
		budget: () => Math.max(4, terminal.rows - CHROME_ROWS),
	});

	const editor = new Editor(tui, theme.editor, { paddingX: 1 });
	const status = new StatusBar(theme, "k9999 · /exit to quit");

	const root = new VStack([transcript, editor, status], { gap: 0 });
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
		status.setMessage("");
		void options.onSubmit(trimmed).catch((error: unknown) => {
			status.setMessage(error instanceof Error ? error.message : String(error));
			tui.requestRender();
		});
	};

	const sink: RenderSink = {
		name: "tui",
		emit(item: RenderItem): void {
			transcript.append(item);
			if (item.kind === "turn") {
				status.setState(item.state);
			}
			tui.requestRender();
		},
		end(state: RunState): void {
			transcript.end(state);
			status.setState(state);
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
