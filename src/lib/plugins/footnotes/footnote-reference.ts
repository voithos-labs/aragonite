/**
 * The reference implementation of an inline rung: `[^label]` claims the ladder's
 * `[^`-prefix rung, consulted before the built-in `[` handler. The literal bytes stay
 * in the block's raw and the number is derived rather than stored. Recognition is gated
 * on registration: absent the plugin, `[` runs its built-in bracket handling instead.
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
 * Materialized once per block, not searched per consultation: an unterminated `[^`
 * declines by reaching the end, so a paragraph full of them paid a block scan each.
 * Bounded rather than weak-keyed because a string cannot key a WeakMap.
 */
const terminatorIndex = createBoundedMemo<string, Int32Array>({ cap: 2 });

function indexLabelTerminators(raw: string): Int32Array {
	const positions: number[] = [];
	for (let i = 0; i < raw.length; i++) {
		if (raw[i] === ']' || isWhitespace(raw[i])) positions.push(i);
	}
	return Int32Array.from(positions);
}

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
 * Every decline falls through to the built-in bracket handler byte-identically. A
 * trailing `(...)` is never consumed: the reference is atomic, so the following bytes
 * rescan as ordinary inline content rather than becoming a link destination.
 */
function recognizeFootnoteReference(
	raw: string,
	pos: number,
	end: number,
	kind: PluginInlineKind
): InlineNode | null {
	if (raw[pos] !== '[' || raw[pos + 1] !== '^') return null;
	const labelStart = pos + 2;
	// The index spans the whole block, so `end` decides the claim: a `]` past the scan
	// range leaves the reference unterminated.
	const close = firstTerminatorFrom(raw, labelStart);
	if (close === -1 || close >= end) return null;
	if (raw[close] !== ']' || close === labelStart) return null;
	return { kind, start: pos, end: close + 1, label: raw.slice(labelStart, close) };
}

export function registerFootnoteReference(): void {
	// Keyed on the kind registry, not a module latch, so the platform reset that clears
	// the inline registries also clears this guard.
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
