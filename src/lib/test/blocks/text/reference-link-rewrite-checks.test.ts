// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { parse } from '$lib/core/parser';
import { parseInline } from '$lib/core/inline';
import { screenVisibility } from '$lib/core/inline/visibility';
import {
	buildLinkReferenceMap,
	type LinkReferenceResolver
} from '$lib/core/inline/link-reference-resolver';
import { resolveMarkedInsertion } from '$lib/components/blocks/text/pending-mark-insert';
import { resolveEdgeSeat } from '$lib/components/blocks/text/edge-seat';
import {
	resolveEdgeDeletion,
	type DeleteDirection,
	type EdgeDeletionSurface
} from '$lib/components/blocks/text/construct-edge-delete';
import { createCompositionSeat } from '$lib/components/blocks/text/composition-seat';
import type { InlineMarkKind } from '$lib/schema/inline-construct-policy';

// Each live rewrite reparses its candidate and compares it with the tree the block drew, which
// was read with the document's link definitions; a candidate read without them sees every
// reference link as brackets, so the two readings disagree beside one (GH #443).
// Miss-analysis: every rewrite fixture used inline links and autolinks, which read the same with
// or without a resolver, and the unit harnesses passed no resolver even to build the drawn tree.

const LIVE = screenVisibility('live', { chromePaints: false });

function resolverFor(display: string): LinkReferenceResolver {
	return buildLinkReferenceMap(parse(`${display}\n\n[ref]: https://x.com\n`).children).resolve;
}

function drawn(display: string) {
	const resolver = resolverFor(display);
	return { resolver, inlines: parseInline(display, 0, display.length, resolver) };
}

describe('a pending mark beside a reference link', () => {
	it('wraps the insertion instead of refusing every candidate', () => {
		const display = 'see [text][ref] here';
		const { resolver, inlines } = drawn(display);
		const marks = new Set<InlineMarkKind>(['strong']);

		expect(
			resolveMarkedInsertion(display, 20, 'y', marks, inlines, resolver, defaultGrammarView)
		).toEqual({ raw: 'see [text][ref] here**y**', caret: 23 });
	});

	it('wraps a composed run the same way', () => {
		const display = 'see [text][ref] here';
		const { resolver, inlines } = drawn(display);
		const seat = createCompositionSeat({
			getDisplayText: () => display,
			getInlines: () => inlines,
			getResolver: () => resolver,
			grammar: defaultGrammarView,
			getAffinity: () => null,
			getScreen: () => LIVE,
			consumePendingMarks: () => new Set<InlineMarkKind>(['strong']),
			restorePendingMarks: () => {}
		});

		seat.noteStart();
		expect(seat.relocate(`${display}かん`, 20)).toEqual({ raw: `${display}**かん**`, caret: 24 });
	});
});

describe('a typed byte at a reference link’s hidden closing run', () => {
	// Past the link, the `*` pairs with the one before `see`, and the text before it turns italic.
	it('is not moved to where it opens an emphasis the user never asked for', () => {
		const display = '*see [te*xt][ref] here';
		const { resolver, inlines } = drawn(display);

		expect(
			resolveEdgeSeat(11, inlines, null, display, LIVE, '*', resolver, defaultGrammarView)
		).toBeNull();
	});
});

describe('a destructive key inside a reference link', () => {
	function del(
		display: string,
		caret: number,
		direction: DeleteDirection,
		installedAs: EdgeDeletionSurface = 'block'
	) {
		const { resolver, inlines } = drawn(display);
		return resolveEdgeDeletion({
			display,
			content: { start: 0, end: display.length },
			caret,
			direction,
			screen: LIVE,
			inlines,
			installedAs,
			resolver,
			grammar: defaultGrammarView
		});
	}

	// `[ef]` names no definition, so the cut would put both brackets on screen.
	it.each<EdgeDeletionSurface>(['block', 'cell'])(
		'takes nothing where the cut breaks the label (%s)',
		(surface) => {
			expect(del('see [ref] here', 4, 'forward', surface)).toEqual({ swallow: true });
		}
	);

	it('unwraps a link the cut empties', () => {
		expect(del('a [t][ref]`c` d', 4, 'backward')).toEqual({
			raw: 'a `c` d',
			caret: 2,
			unwrappedMarks: []
		});
	});
});
