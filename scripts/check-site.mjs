#!/usr/bin/env node
/**
 * Fail if the product page loads anything over the network.
 *
 * The page's value is that it renders with no network, so a CDN font or script
 * added later must break the build rather than appear in a browser as a slow,
 * half-styled page.
 *
 * The distinction that matters is resources versus links:
 *
 * - A resource is fetched to render the document: `src`, `<link href>`, CSS
 *   `@import` and `url()`. One of these over the network breaks offline
 *   rendering, and fails this check.
 * - A hyperlink (`<a href>`) is followed only when a reader clicks it. It costs
 *   nothing offline, and a page documenting a project needs them.
 *
 * Inline `data:` URIs and fragment-only references are always allowed.
 */
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "site/index.html";
const html = readFileSync(file, "utf8");

const failures = [];

function isRemote(value) {
	const trimmed = value.trim();
	if (trimmed === "") return false;
	if (trimmed.startsWith("data:")) return false;
	if (trimmed.startsWith("#")) return false;
	return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(trimmed);
}

// Attributes that cause a fetch. `href` is included only on elements that load
// rather than navigate.
const RESOURCE_ATTRIBUTES = /\b(src|srcset|poster|data)\s*=\s*["']([^"']*)["']/gi;
for (const match of html.matchAll(RESOURCE_ATTRIBUTES)) {
	const [, attribute, value] = match;
	if (isRemote(value)) {
		failures.push(`<${attribute}> loads ${value}`);
	}
}

// `<link href>` loads; `<a href>` navigates.
const LINK_ELEMENTS = /<link\b[^>]*>/gi;
for (const match of html.matchAll(LINK_ELEMENTS)) {
	const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(match[0]);
	if (href && isRemote(href[1])) {
		failures.push(`<link> loads ${href[1]}`);
	}
}

// CSS can fetch without any attribute, in a stylesheet or a style attribute.
const CSS_LOADS = /@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi;
for (const match of html.matchAll(CSS_LOADS)) {
	if (isRemote(match[1])) {
		failures.push(`@import loads ${match[1]}`);
	}
}
const CSS_URLS = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
for (const match of html.matchAll(CSS_URLS)) {
	if (isRemote(match[1])) {
		failures.push(`url() loads ${match[1]}`);
	}
}

if (failures.length > 0) {
	process.stderr.write(`${file} loads external resources, so it will not render offline:\n`);
	for (const failure of failures) {
		process.stderr.write(`  ${failure}\n`);
	}
	process.exit(1);
}

const links = (html.match(/<a\b[^>]*\bhref\s*=\s*["']https?:\/\//gi) ?? []).length;
process.stdout.write(`${file} loads nothing external; ${links} outbound hyperlink(s) allowed\n`);
