/**
 * Visibility gate + DOM builder for the decoded-entity inline widget. A
 * character reference (`&copy;`, `&#169;`) renders as an atomic widget showing
 * its decoded glyph — but only when that glyph is visible. An entity whose
 * decoded value is entirely control / format / whitespace characters
 * (`&nbsp;` → U+00A0, `&ZeroWidthSpace;`, `&NewLine;`) keeps its literal-source
 * span: an invisible atomic island is a caret trap. The widget adopts the
 * generic `[data-inline-widget]` marker + `data-source-*` offsets, so the
 * cursor walk, selection paint, and raw reader handle it with no per-kind
 * plumbing.
 */

import type { InlineNode } from '../nodes';

// A decoded string renders no glyph when every code point is a control (`Cc`),
// format (`Cf`), or whitespace (`Zs`/`Zl`/`Zp`) character. `\p{Zs}` covers the
// non-breaking space (U+00A0) — `&nbsp;`'s glyph would be an invisible column,
// so it stays a literal span like a plain space. `\p{Cf}` covers the
// zero-width joiners and the BOM; `\p{Cc}` covers tab/newline/DEL and the C1
// range. The empty string (a non-decoding node) is invisible by the same test.
const RENDERS_NO_GLYPH = /^[\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}]*$/u;

/** True when the entity's decoded value renders at least one visible glyph, so
 *  it should render as an atomic widget rather than its literal source span. */
export function entityRendersGlyph(decoded: string | undefined): boolean {
	return decoded !== undefined && !RENDERS_NO_GLYPH.test(decoded);
}

/** Build the atomic-widget DOM for a visibly-rendering entity: a
 *  `[data-inline-widget]` shell whose text is the decoded glyph and whose
 *  source bytes ride `data-source-*`, so the raw-aware walk reads back `&copy;`
 *  while the DOM shows `©`. */
export function buildEntityWidget(node: InlineNode): HTMLSpanElement {
	const shell = document.createElement('span');
	shell.className = 'md-entity-widget';
	shell.dataset.inlineWidget = '';
	shell.dataset.sourceStart = String(node.start);
	shell.dataset.sourceEnd = String(node.end);
	shell.setAttribute('contenteditable', 'false');
	shell.textContent = node.decoded ?? '';
	return shell;
}
