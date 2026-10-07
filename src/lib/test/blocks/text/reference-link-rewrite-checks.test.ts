// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
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
	type DeleteDirection
} from '$lib/components/blocks/text/construct-edge-delete';
import { createCompositionSeat } from '$lib/components/blocks/text/composition-seat';
import type { InlineMarkKind } from '$lib/schema/inline-construct-policy';
import { makeBlockNode } from '$lib/core/nodes';
import { fixtureReading, topLevelStore } from '$lib/test/harness/fixture-grammar';

/** A prose block stores a block; a table cell stores text. */
type StoredKind = 'paragraph' | 'tableCell';

// Each live rewrite reads its candidate with the link definitions the drawn tree was read with.
// Miss-analysis: GH #443, rewrite fixtures used only links that read the same without a resolver.

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
			resolveMarkedInsertion(
				display,
				20,
				'y',
				marks,
				inlines,
				fixtureReading({ resolver: resolver })
			)
		).toEqual({ raw: 'see [text][ref] here**y**', caret: 23 });
	});

	it('wraps a composed run the same way', () => {
		const display = 'see [text][ref] here';
		const { resolver, inlines } = drawn(display);
		const seat = createCompositionSeat({
			getDisplayText: () => display,
			getInlines: () => inlines,
			reading: fixtureReading({ resolver: resolver }),
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
			resolveEdgeSeat(11, inlines, null, display, LIVE, '*', fixtureReading({ resolver: resolver }))
		).toBeNull();
	});
});

describe('a destructive key inside a reference link', () => {
	function del(
		display: string,
		caret: number,
		direction: DeleteDirection,
		kind: StoredKind = 'paragraph'
	) {
		const { resolver, inlines } = drawn(display);
		const node = makeBlockNode({ kind, leadingTrivia: '', raw: display });
		return resolveEdgeDeletion({
			display,
			content: { start: 0, end: display.length },
			caret,
			direction,
			screen: LIVE,
			inlines,
			store: topLevelStore(node, fixtureReading({ resolver: resolver }))
		});
	}

	// `[ef]` names no definition, so the cut would put both brackets on screen.
	it.each<StoredKind>(['paragraph', 'tableCell'])(
		'takes nothing where the cut breaks the label (%s)',
		(kind) => {
			expect(del('see [ref] here', 4, 'forward', kind)).toEqual({ swallow: true });
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
