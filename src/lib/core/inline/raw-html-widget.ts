/**
 * Allowlist + builder for live-rendered inline HTML widgets. 0.6.7.1 ships
 * with `<br>` only; the Set is the patch-version extension point.
 *
 * Widgets adopt the existing `[data-inline-widget]` generic marker so they
 * automatically participate in cursor / vertical-skip / edge-select via
 * `cursor/widget-offset.ts` (no changes to that file required). Kind-specific
 * styling and behavior layers on via class names if needed.
 */

import type { InlineNode } from '../nodes';

/** Tag names (lowercase) that render as live DOM widgets instead of literal
 *  source spans. Today: `<br>` only. Patch versions and post-1.2 plugins may
 *  extend this set. Tags that appear in §6.11's disallowed list must never
 *  be added here. */
export const LIVE_HTML_TAGS: ReadonlySet<string> = new Set(['br']);

const TAG_NAME_EXTRACT = /^<\/?([A-Za-z][A-Za-z0-9-]*)/;

/** True when the source slice represents an open / close / self-closing tag
 *  whose name is in the live allowlist. Comments, PIs, declarations, and
 *  CDATA never match (they have no tag name). Case-insensitive. */
export function isLiveHtmlTag(slice: string): boolean {
	const m = TAG_NAME_EXTRACT.exec(slice);
	if (!m) return false;
	return LIVE_HTML_TAGS.has(m[1].toLowerCase());
}

/** Build the atomic-widget DOM for a live-rendered inline HTML tag. Today
 *  the only live tag is `<br>` — the outer span is the atomic-widget shell
 *  the cursor machinery recognizes (via `[data-inline-widget]`); the inner
 *  `<br>` produces the actual line break visually. */
export function buildLiveHtmlWidget(node: InlineNode): HTMLSpanElement {
	const shell = document.createElement('span');
	shell.className = 'md-br-widget';
	shell.dataset.inlineWidget = '';
	shell.dataset.sourceStart = String(node.start);
	shell.dataset.sourceEnd = String(node.end);
	shell.setAttribute('contenteditable', 'false');
	shell.appendChild(document.createElement('br'));
	return shell;
}

/** True when the inline node renders as a live atomic widget in the DOM
 *  (image, or rawHtml whose source slice is in the live allowlist). Used by
 *  TextEditableBlock's widget-aware code paths (cursor adjacency, edge-widget
 *  select, vertical-skip) to recognize br widgets alongside images. */
export function isLiveWidgetInline(inline: InlineNode, raw: string): boolean {
	if (inline.kind === 'image') return true;
	if (inline.kind === 'rawHtml') {
		return isLiveHtmlTag(raw.slice(inline.start, inline.end));
	}
	return false;
}
