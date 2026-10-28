// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { parseInline } from '#lib/core/inline/index.js';
import { screenVisibility } from '#lib/core/inline/visibility.js';
import { definitionsOf, type LinkReferenceResolver } from '#lib/core/inline/scan/definitions.js';
import { resolveMarkedInsertion } from '#lib/components/blocks/text/pending-mark-insert.js';
import { hiddenEdges } from '#lib/components/blocks/text/edge-seat.js';
import { resolveEdgeDeletion } from '#lib/components/blocks/text/construct-edge-delete.js';
import type { DeleteDirection } from '#lib/browser/input.js';
import type { InlineMarkKind } from '#lib/schema/inline-construct-policy.js';
import { makeBlockNode } from '#lib/core/nodes.js';
import { fixtureReading, topLevelStore } from '#lib/test/harness/fixture-grammar.js';

/** A prose block stores a block; a table cell stores text. */
type StoredKind = 'paragraph' | 'tableCell';

// Each live rewrite reads its candidate with the link definitions the drawn tree was read with.
// Miss-analysis: GH #443, rewrite fixtures used only links that read the same without a resolver.

const LIVE = screenVisibility('live', { chromePaints: false });

function resolverFor(display: string): LinkReferenceResolver {
	return definitionsOf(parse(`${display}\n\n[ref]: https://x.com\n`).children).resolve;
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
});

describe('a typed byte at a reference link’s hidden closing run', () => {
	// Past the link, the `*` pairs with the one before `see`, and the text before it turns italic.
	it('is not moved to where it opens an emphasis the user never asked for', () => {
		const display = '*see [te*xt][ref] here';
		const { resolver, inlines } = drawn(display);

		const edges = hiddenEdges(inlines, display, LIVE, fixtureReading({ resolver: resolver }));
		expect(edges.typingOffset(11, null, '*')).toBe(11);
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
			asWritten: (text) => text,
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
