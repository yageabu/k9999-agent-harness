#!/usr/bin/env node
/**
 * Fail if any published page or drawing loads something over the network.
 *
 * The site's value is that it renders with no network, so a CDN font or script
 * added later must break the build rather than appear in a browser as a slow,
 * half-styled page.
 *
 * The distinction that matters is resources versus links:
 *
 * - A resource is fetched to render the document: `src`, `<link href>`, an SVG
 *   `href` on an image or use element, CSS `@import` and `url()`. One of these
 *   over the network breaks offline rendering, and fails this check.
 * - A hyperlink (`<a href>`) is followed only when a reader clicks it. It costs
 *   nothing offline, and a page documenting a project needs them.
 *
 * Inline `data:` URIs and fragment-only references are always allowed. Every
 * `.html` and `.svg` in the directory is checked, not just `index.html`, because
 * a font pulled in by a drawing is the same failure in a less obvious place.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const target = process.argv[2] ?? "site";

function isRemote(value) {
	const trimmed = value.trim();
	if (trimmed === "") return false;
	if (trimmed.startsWith("data:")) return false;
	if (trimmed.startsWith("#")) return false;
	return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(trimmed);
}

function collectFiles(entry) {
	if (statSync(entry).isFile()) {
		return [entry];
	}
	const files = [];
	for (const name of readdirSync(entry).sort()) {
		const child = path.join(entry, name);
		if (statSync(child).isDirectory()) {
			files.push(...collectFiles(child));
			continue;
		}
		if (name.endsWith(".html") || name.endsWith(".svg")) {
			files.push(child);
		}
	}
	return files;
}

const failures = [];

for (const file of collectFiles(target)) {
	const text = readFileSync(file, "utf8");

	// Attributes that cause a fetch. `href` is included only on elements that
	// load rather than navigate, which for SVG means image and use.
	const attributePatterns = [
		/\b(src|srcset|poster)\s*=\s*["']([^"']*)["']/gi,
		/<(?:image|use)\b[^>]*\bhref\s*=\s*["']([^"']*)["']/gi,
	];
	for (const [index, pattern] of attributePatterns.entries()) {
		for (const match of text.matchAll(pattern)) {
			const value = index === 0 ? match[2] : match[1];
			if (isRemote(value)) {
				failures.push(`${file}: ${match[0].split("=")[0].trim()} loads ${value}`);
			}
		}
	}

	// `<link href>` loads; `<a href>` navigates.
	for (const match of text.matchAll(/<link\b[^>]*>/gi)) {
		const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(match[0]);
		if (href && isRemote(href[1])) {
			failures.push(`${file}: <link> loads ${href[1]}`);
		}
	}

	// CSS can fetch without any attribute, in a stylesheet or a style attribute.
	for (const match of text.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi)) {
		if (isRemote(match[1])) {
			failures.push(`${file}: @import loads ${match[1]}`);
		}
	}
	for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
		if (isRemote(match[1])) {
			failures.push(`${file}: url() loads ${match[1]}`);
		}
	}
}

if (failures.length > 0) {
	process.stderr.write(`${target} loads external resources, so it will not render offline:\n`);
	for (const failure of failures) {
		process.stderr.write(`  ${failure}\n`);
	}
	process.exit(1);
}

const files = collectFiles(target);
const links = files.reduce(
	(sum, file) => sum + (readFileSync(file, "utf8").match(/<a\b[^>]*\bhref\s*=\s*["']https?:\/\//gi) ?? []).length,
	0,
);
process.stdout.write(
	`${files.length} file(s) under ${target} load nothing external; ${links} outbound hyperlink(s) allowed\n`,
);
