/**
 * The `[^label]` reference: a first-class inline kind, recognized through the
 * inline priority ladder's `[^`-prefix rung (consulted before the built-in `[`
 * handler) and rendered as a superscript-number widget. The literal `[^label]`
 * bytes stay in the block's raw, so round-trip and GFM portability are untouched;
 * the number is derived, not stored (see FootnoteReference.svelte).
 *
 * Recognition is gated on registration: with the plugin absent the `[` scanner
 * runs its built-in bracket handling, leaving `[^label]` byte-identical to bare GFM.
 */

import {
	INLINE_PRIORITIES,
	declarePluginInlineKind,
	isInlineKindDeclared,
	registerInlineSyntax,
	registerInlineWidgetKind,
	type InlineNode,
	type PluginInlineKind
} from '$lib/plugin';
import FootnoteReference from './FootnoteReference.svelte';
import { FOOTNOTE_REF_KIND } from './constants';

const isWhitespace = (ch: string) => /\s/.test(ch);

/**
 * `[^label]` recognizer over `raw[pos, end)`, where `pos` is the opening `[`.
 * Claims `[pos, close + 1)` when a non-empty label of non-space, non-`]` chars is
 * closed by `]`. Declines (null) on a missing `^`, an empty label, whitespace in
 * the label, or an unterminated reference — each falls through to the built-in
 * bracket handler byte-identically. A trailing `(...)` is never consumed: the
 * reference is atomic and the following bytes rescan as ordinary inline content.
 */
function recognizeFootnoteReference(
	raw: string,
	pos: number,
	end: number,
	kind: PluginInlineKind
): InlineNode | null {
	if (raw[pos] !== '[' || raw[pos + 1] !== '^') return null;
	const labelStart = pos + 2;
	let i = labelStart;
	while (i < end && raw[i] !== ']') {
		if (isWhitespace(raw[i])) return null;
		i++;
	}
	if (i >= end || i === labelStart) return null;
	return { kind, start: pos, end: i + 1, label: raw.slice(labelStart, i) };
}

export function registerFootnoteReference(): void {
	// Keyed on the declared-inline-kind registry, not a module latch: the test reset
	// that clears the inline syntax/widget registries also clears this key, so a
	// reset → re-register re-runs the whole path cleanly (the inline-math mold).
	if (isInlineKindDeclared(FOOTNOTE_REF_KIND)) return;
	const kind = declarePluginInlineKind(FOOTNOTE_REF_KIND);
	registerInlineSyntax('[', (raw, pos, end) => recognizeFootnoteReference(raw, pos, end, kind), {
		prefix: '[^',
		priority: INLINE_PRIORITIES.prefixOverride
	});
	registerInlineWidgetKind(kind, {
		isWidget: () => true,
		component: FootnoteReference,
		editing: { revealSource: true }
	});
}
