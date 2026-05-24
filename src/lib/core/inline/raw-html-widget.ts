/**
 * Allowlist + builder for live-rendered inline HTML widgets. Widgets adopt
 * the `[data-inline-widget]` generic marker so they participate in cursor /
 * vertical-skip / edge-select via `cursor/widget-offset.ts` without per-kind
 * plumbing.
 */

import type { InlineNode } from '../nodes';

/** Tag names (lowercase) that render as live DOM widgets instead of literal
 *  source spans. Plugins extend this set; tags in §6.11's disallowed list must never
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
