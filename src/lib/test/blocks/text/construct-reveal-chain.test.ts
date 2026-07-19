// The trigger math behind preview-inline's marker reveal: which constructs'
// markers the caret offset asks to reveal. Inclusive on both edges — the reveal
// must precede the arrow step that would land in marker text — and full-chain
// for nested constructs. DOM flips are construct-reveal-trigger.test.ts.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { getInlineContent } from '$lib/core/inline/inline-cache';
import { findNodeAtOffset } from '$lib/core/inline-render';
import { constructChainAtOffset } from '$lib/components/blocks/text/construct-reveal';

function chainKinds(md: string, offset: number): string[] {
	const node = parse(md + '\n').children[0];
	return constructChainAtOffset(getInlineContent(node), offset).map((n) => n.kind);
}

describe('constructChainAtOffset', () => {
	it('plain text yields no chain', () => {
		expect(chainKinds('alpha beta', 3)).toEqual([]);
	});

	it('a caret inside a construct yields it; just outside yields nothing', () => {
		// `a **b** c` — strong spans [2,7).
		expect(chainKinds('a **b** c', 4)).toEqual(['strong']);
		expect(chainKinds('a **b** c', 1)).toEqual([]);
		expect(chainKinds('a **b** c', 8)).toEqual([]);
	});

	it('edges are inclusive on both sides', () => {
		expect(chainKinds('a **b** c', 2)).toEqual(['strong']);
		expect(chainKinds('a **b** c', 7)).toEqual(['strong']);
	});

	it('the end edge reveals even though findNodeAtOffset right-prefers past it', () => {
		// The reveal is deliberately MORE inclusive than the boundary lookup: at
		// offset 7 the model lookup resolves the following text node, but the arrow
		// step from 7 goes into marker text, so the construct must already show.
		const node = parse('a **b** c\n').children[0];
		const inlines = getInlineContent(node);
		expect(findNodeAtOffset(inlines, 7)?.node.kind).toBe('text');
		expect(constructChainAtOffset(inlines, 7).map((n) => n.kind)).toEqual(['strong']);
	});

	it('a boundary shared by adjacent constructs reveals both', () => {
		// `*a*` [0,3) then '`b`' [3,6). Both reveal — the caret is a raw offset and
		// insertion lands at it; there is no boundary "winner" to pick (affinity contract).
		expect(chainKinds('*a*`b`', 3)).toEqual(['emphasis', 'inlineCode']);
		// The truly-adjacent strong→emphasis run resolves the same way at its shared
		// raw offset: `**a***b*` — strong [0,5), emphasis [5,8) — both show at 5.
		expect(chainKinds('**a***b*', 5)).toEqual(['strong', 'emphasis']);
	});

	it('a construct filling the whole block reveals at both block edges', () => {
		// Block-start/end edge: offset 0 and the block-final offset are inclusive, so a
		// leftward walk into the opening `**` (and a rightward one into the closing `**`)
		// reveals — the markers are steppable before the caret would land in them.
		expect(chainKinds('**bold**', 0)).toEqual(['strong']);
		expect(chainKinds('**bold**', 8)).toEqual(['strong']);
	});

	it('empty wrapped markup is literal text, never a construct — no chain', () => {
		// CommonMark forbids empty emphasis: `****` is four literal asterisks, not an
		// empty strong, so the "empty construct" boundary case does not exist — a caret
		// among the asterisks sees plain text with nothing to reveal.
		expect(chainKinds('a **** b', 4)).toEqual([]);
	});

	it('nested constructs yield the full chain, outermost first', () => {
		// `**bold *italic* tail**` — strong [0,22), emphasis [7,15).
		expect(chainKinds('**bold *italic* tail**', 10)).toEqual(['strong', 'emphasis']);
		// Inside the strong but outside the emphasis: only the outer wrapper.
		expect(chainKinds('**bold *italic* tail**', 4)).toEqual(['strong']);
	});

	it('a link chains with its nested formatting', () => {
		// `[x **y**](u)` — link wraps text `x ` and strong [3,8).
		expect(chainKinds('[x **y**](u)', 5)).toEqual(['link', 'strong']);
		expect(chainKinds('[x **y**](u)', 1)).toEqual(['link']);
	});

	it('inline code reveals across its whole span, ticks included', () => {
		expect(chainKinds('`code`', 0)).toEqual(['inlineCode']);
		expect(chainKinds('`code`', 6)).toEqual(['inlineCode']);
	});

	it('non-revealable kinds never join the chain', () => {
		// Escape [0,2) and autolink: markers exist (escape) or not (autolink), but
		// neither is construct-reveal's to flip in this batch.
		expect(chainKinds('\\*a', 1)).toEqual([]);
		expect(chainKinds('<https://x.dev>', 4)).toEqual([]);
	});
});
