/**
 * Visibility gate and DOM builder for the decoded-entity inline widget. A character reference
 * renders as an atomic widget showing its decoded glyph, but only when that glyph is visible:
 * an entity decoding to nothing drawable (`&nbsp;`, `&ZeroWidthSpace;`) keeps its literal
 * source span, because an invisible atomic island is a caret trap.
 */

import type { InlineNode } from '../nodes';
import { mintWidgetShell } from './inline-widgets';

// Zero-advance categories only. `Mn`/`Me` are here because a lone combining mark (`&#x301;`)
// has nothing to combine with and draws nothing; spacing marks (`Mc`) keep real advance and
// stay widgets. The empty string (a non-decoding node) is invisible by the same test.
const RENDERS_NO_GLYPH = /^[\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}\p{Mn}\p{Me}]*$/u;

/** True when the decoded value draws at least one glyph, so it earns a widget. */
export function entityRendersGlyph(decoded: string | undefined): boolean {
	return decoded !== undefined && !RENDERS_NO_GLYPH.test(decoded);
}

/** Source bytes ride the shell's `data-source-*`, so the raw-aware walk reads back `&copy;`. */
export function buildEntityWidget(node: InlineNode): HTMLSpanElement {
	const shell = mintWidgetShell('md-entity-widget', node);
	shell.textContent = node.decoded ?? '';
	return shell;
}
