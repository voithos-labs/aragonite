/**
 * Allowlist and builder for live-rendered inline HTML widgets. They adopt the generic
 * `[data-inline-widget]` marker, so cursor, vertical-skip, and edge-select need no per-kind
 * plumbing (`cursor/widget-offset.ts`).
 */

import type { InlineNode } from '../nodes';
import { mintWidgetShell } from './inline-widgets';

/** A tag from GFM §6.11's disallowed-raw-HTML list must never be added here. */
export const LIVE_HTML_TAGS: ReadonlySet<string> = new Set(['br']);

const TAG_NAME_EXTRACT = /^<\/?([A-Za-z][A-Za-z0-9-]*)/;

/** Comments, PIs, declarations, and CDATA never match: they have no tag name. */
export function isLiveHtmlTag(slice: string): boolean {
	const m = TAG_NAME_EXTRACT.exec(slice);
	if (!m) return false;
	return LIVE_HTML_TAGS.has(m[1].toLowerCase());
}

/** The outer span is the shell the cursor machinery recognizes; the inner `<br>` breaks. */
export function buildLiveHtmlWidget(node: InlineNode): HTMLSpanElement {
	const shell = mintWidgetShell('md-br-widget', node);
	shell.appendChild(document.createElement('br'));
	return shell;
}
