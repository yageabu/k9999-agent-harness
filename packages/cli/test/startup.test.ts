import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createStyler } from "../src/render/format.ts";
import {
	compactHints,
	expandedHints,
	logoLine,
	resourceSections,
	startupLines,
	StartupHeader,
	type StartupFacts,
} from "../src/tui/startup.ts";
import { logoLines } from "../src/tui/logo.ts";

const plain = createStyler(false);

function facts(overrides: Partial<StartupFacts> = {}): StartupFacts {
	return {
		appName: "k9999",
		version: "0.5.0",
		profileId: "code",
		profileName: "Code Agent",
		profileDir: "/home/dev/project/profiles/code",
		model: "deepseek/deepseek-flash",
		thinking: "medium",
		tools: [
			{ name: "read", description: "Read a text file and return numbered lines." },
			{ name: "bash", description: "Run a shell command in the working directory." },
		],
		skills: [{ name: "linkbus-dev", description: "The LinkBus development workflow." }],
		home: "/home/dev",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// the logo and the hints
// ---------------------------------------------------------------------------

test("the logo names the command and its version", () => {
	assert.equal(logoLine(facts(), plain), "k9999 v0.5.0");
});

test("the compact hints name only keys the TUI answers to", () => {
	const line = compactHints(plain);
	for (const expected of ["escape interrupt", "ctrl+c/ctrl+d clear/exit", "/exit quit", "ctrl+o more"]) {
		assert.match(line, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}
	// A hint is a claim about behavior. The TUI has no slash-command menu and no
	// `!` shell passthrough, so neither may be advertised.
	assert.equal(line.includes("!"), false, "no shell passthrough is implemented");
	assert.equal(line.includes("commands"), false, "no command menu is implemented");
});

test("the expanded hints say more than the compact line", () => {
	const lines = expandedHints(plain);
	assert.ok(lines.length > 3);
	const text = lines.join("\n");
	assert.match(text, /escape to interrupt the turn/);
	assert.match(text, /ctrl\+c to clear the prompt, twice to exit/);
	assert.match(text, /ctrl\+d to exit when the prompt is empty/);
	assert.match(text, /\/exit, \/quit to leave/);
	assert.match(text, /ctrl\+o to collapse this help/);
});

// ---------------------------------------------------------------------------
// the loaded resources
// ---------------------------------------------------------------------------

test("resources collapse to names and expand to detail", () => {
	const collapsed = resourceSections(facts(), plain, false).join("\n");
	assert.match(collapsed, /\[Profile\]/);
	assert.match(collapsed, /\[Tools\]/);
	assert.match(collapsed, /\[Skills\]/);
	assert.match(collapsed, /read, bash/);
	assert.match(collapsed, /linkbus-dev/);
	assert.equal(collapsed.includes("numbered lines"), false, "a collapsed section carries no descriptions");

	const expanded = resourceSections(facts(), plain, true).join("\n");
	assert.match(expanded, /read {2}Read a text file/);
	assert.match(expanded, /linkbus-dev {2}The LinkBus development workflow\./);
	assert.match(expanded, /~\//, "the profile directory is shortened against the home directory");
});

test("a section with nothing in it is dropped rather than printed empty", () => {
	const sections = resourceSections(facts({ skills: [] }), plain, false).join("\n");
	assert.equal(sections.includes("[Skills]"), false);
});

// ---------------------------------------------------------------------------
// the block
// ---------------------------------------------------------------------------

test("the startup block carries the logo, the help and the resources", () => {
	const lines = startupLines(facts(), plain, 100, false);
	const text = lines.join("\n");
	assert.equal(lines[0], " k9999 v0.5.0", "the logo block is inset by one column, as Pi's is");
	assert.match(text, /Press ctrl\+o to show full startup help and loaded resources\./);
	assert.match(text, /Ask k9999 about this directory\./);
	assert.match(text, /\[Tools\]/, "the resource sections are not inset");
});

test("no line is wider than the terminal, however narrow", () => {
	for (const width of [16, 24, 40, 80, 120]) {
		for (const logo of [undefined, logoLines("k9999")]) {
			for (const line of startupLines(facts(), plain, width, true, logo)) {
				assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
			}
		}
	}
});

// ---------------------------------------------------------------------------
// the block logo
// ---------------------------------------------------------------------------

test("the art replaces the one-line name, with the version beside its last row", () => {
	const lines = startupLines(facts(), plain, 80, false, logoLines("k9999"));
	assert.match(lines[0] ?? "", /^ ██╗  ██╗/, "the art is inset one column, like the rest of the block");
	assert.match(lines[5] ?? "", /╚═╝  ╚═╝ ╚════╝.*v0\.5\.0$/);
	assert.equal(lines.join("\n").includes("k9999 v0.5.0"), false, "the one-line name is gone when the art is shown");
});

test("a command with no art falls back to the one-line name", () => {
	const lines = startupLines(facts({ appName: "nope" }), plain, 80, false, undefined);
	assert.equal(lines[0], " nope v0.5.0");
});

test("the art is used when the terminal has room for it", () => {
	const header = new StartupHeader(facts(), plain, { budget: () => 100 });
	assert.match(header.render(80)[0] ?? "", /^ ██╗/);
});

test("a narrow terminal falls back rather than wrapping the art", () => {
	// 40 columns of art plus the inset, the gutter and `v0.5.0` need 50.
	const header = new StartupHeader(facts(), plain, { budget: () => 100 });
	assert.equal(header.render(49)[0], " k9999 v0.5.0");
	assert.match(header.render(50)[0] ?? "", /^ ██╗/);
});

test("a short terminal falls back rather than scrolling its own logo away", () => {
	const header = new StartupHeader(facts(), plain, { budget: () => 4 });
	assert.equal(header.render(80)[0], " k9999 v0.5.0");
});

test("kula gets the art for its own name", () => {
	const kula = facts({ appName: "kula", profileId: "data", profileName: "Data Analysis Agent" });
	assert.match(startupLines(kula, plain, 80, false, logoLines("kula"))[0] ?? "", /█╗   ██╗██╗/);
	assert.match(startupLines(kula, plain, 80, false, undefined)[0] ?? "", /^ kula v0\.5\.0$/);
});

test("ctrl+o swaps the hint line for the list and the sections with it", () => {
	const header = new StartupHeader(facts(), plain);
	const collapsed = header.render(100).join("\n");
	assert.match(collapsed, /Press ctrl\+o/);
	assert.equal(collapsed.includes("numbered lines"), false);

	assert.equal(header.toggle(), true);
	assert.equal(header.isExpanded, true);
	const expanded = header.render(100).join("\n");
	assert.equal(expanded.includes("Press ctrl+o"), false);
	assert.match(expanded, /escape to interrupt the turn/);
	assert.match(expanded, /numbered lines/);

	assert.equal(header.toggle(), false);
	assert.match(header.render(100).join("\n"), /Press ctrl\+o/);
});
