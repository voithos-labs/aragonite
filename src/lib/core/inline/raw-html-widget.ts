/**
 * Allowlist + builder for live-rendered inline HTML widgets. Widgets adopt
 * the `[data-inline-widget]` generic marker so they participate in cursor /
 * vertical-skip / edge-select via `cursor/widget-offset.ts` without per-kind
 * plumbing.
 */

import type { InlineNode } from '../nodes';
import { mintWidgetShell } from './inline-widgets';

/** Tag names (lowercase) that render as live DOM widgets instead of literal
 *  source spans. A tag from GFM §6.11's disallowed-raw-HTML list must never be
 *  added here. */
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
	const shell = mintWidgetShell('md-br-widget', node);
	shell.appendChild(document.createElement('br'));
	return shell;
}
