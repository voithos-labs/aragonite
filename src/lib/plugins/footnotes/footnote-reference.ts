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
	createBoundedMemo,
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
 * Label-terminator positions (`]` closes, whitespace declines) for one block's raw.
 * A forward search per consultation costs a full block scan every time it declines,
 * and an unterminated `[^` declines by reaching the end — so a paragraph carrying
 * many of them paid one block scan each. The terminator set reads only `raw`, so it
 * is materialized once and each consultation looks it up (the backtick-run index's
 * shape). Bounded rather than weak-keyed because a string cannot key a WeakMap; two
 * entries cover a block's own scan, the only place consecutive consultations share
 * a `raw`.
 */
const terminatorIndex = createBoundedMemo<string, Int32Array>({ cap: 2 });

function indexLabelTerminators(raw: string): Int32Array {
	const positions: number[] = [];
	for (let i = 0; i < raw.length; i++) {
		if (raw[i] === ']' || isWhitespace(raw[i])) positions.push(i);
	}
	return Int32Array.from(positions);
}

/** First label terminator at or after `from`, or -1 when the block holds none. */
function firstTerminatorFrom(raw: string, from: number): number {
	const positions = terminatorIndex(raw, () => indexLabelTerminators(raw));
	let lo = 0;
	let hi = positions.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (positions[mid] < from) lo = mid + 1;
		else hi = mid;
	}
	return lo < positions.length ? positions[lo] : -1;
}

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
	// The index spans the whole block, so `end` — not the block string — decides the
	// claim: a `]` past the scan range leaves the reference unterminated.
	const close = firstTerminatorFrom(raw, labelStart);
	if (close === -1 || close >= end) return null;
	if (raw[close] !== ']' || close === labelStart) return null;
	return { kind, start: pos, end: close + 1, label: raw.slice(labelStart, close) };
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
