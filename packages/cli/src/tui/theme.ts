import type { EditorTheme, SelectListTheme } from "@earendil-works/pi-tui";
import { type ColorMode, createStyler, resolveColor, type Styler } from "../render/format.ts";

export interface TuiTheme {
	readonly styler: Styler;
	readonly editor: EditorTheme;
}

/**
 * One palette, matching `site/index.html`.
 *
 * pi-tui takes colours by injection rather than defining them, so this is the
 * single place the terminal palette is decided. A theme system before a second
 * user exists would be speculation; one file is not.
 */
export function createTuiTheme(color: ColorMode = "auto"): TuiTheme {
	const s = createStyler(resolveColor(color, process.stdout));

	const selectList: SelectListTheme = {
		selectedPrefix: s("cyan"),
		selectedText: s("bold"),
		description: s("dim"),
		scrollInfo: s("dim"),
		noMatch: s("dim"),
	};

	return {
		styler: s,
		editor: {
			borderColor: s("dim"),
			selectList,
		},
	};
}
