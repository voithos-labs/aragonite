// G1.212: a range read as bytes spans every block its coverage holds whole, over the documents and
// ranges the range laws draw. Miss-analysis: the laws compare a copy with a removal, both read
// their bytes in one place, so a range wrong for both agreed with itself.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Document } from '../../core/nodes';
import { checkRangeHoldsWhole } from '../../invariants/range-holds-whole';
import { displayLength } from '../../core/lines';
import { documentLayout, type Layout } from '../../range-edit/layout';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { defaultGrammarView } from '../../schema/block-openers';
import { installPlugins } from '../../schema/plugin-install';
import { rangeBytes, wholeBlockBytes } from '../../selection/range-bytes';
import { coverRange, rangeCoverage } from '../../selection/range-coverage';
import { measured } from '../../tree-operations/top-level-starts';
import { SYNTAX_PLUGINS } from '../behavior/corpus';
import { bytePositions, opened, pointKey } from '../range-laws/positions';
import { arbRangeSeed, resolveRange } from '../range-laws/ranges';
import { arbLawDocument } from '../range-laws/shapes';
import { takeDevWarns } from '../support/warn-gate';
import { freshOrFixedSeed } from './arbitraries';

/** A block's span as the parser alone reads it: a leaf whose line runs past its bytes (a title
 *  row inside its container's tags) ends at its last character; any other at its last line. */
function heldSpan(source: string, doc: Document, layout: Layout, root: readonly number[]) {
	const span = wholeBlockBytes(doc, layout, root)!;
	const node = blockNodeAt(doc, root)!;
	if (node.children?.length || span.to - span.from <= displayLength(node.raw)) return span;
	const last = bytePositions(source, defaultGrammarView).get(
		pointKey(root, displayLength(node.raw))
	);
	return { from: span.from, to: last ?? span.to };
}

describe('G1.212 a range read as bytes holds every block it holds whole', () => {
	it('names the block a range cuts, and passes one it spans', () => {
		expect(checkRangeHoldsWhole({ from: 0, to: 49 }, [{ from: 0, to: 49 }])).toBeNull();
		expect(checkRangeHoldsWhole({ from: 0, to: 22 }, [{ from: 0, to: 49 }])).toMatchObject({
			code: 'range-holds-whole'
		});
		expect(checkRangeHoldsWhole({ from: 5, to: 49 }, [{ from: 0, to: 49 }])).not.toBeNull();
	});

	it('over the law corpus', () => {
		installPlugins(SYNTAX_PLUGINS);
		fc.assert(
			fc.property(arbLawDocument, arbRangeSeed, (source, seed) => {
				const doc = opened(source, defaultGrammarView) as Document;
				const range = resolveRange(doc, seed);
				if (!range) return;
				const coverage = rangeCoverage(doc, coverRange(doc, range.anchor, range.focus));
				const layout = documentLayout(measured(doc));
				const bytes = rangeBytes(doc, coverage, layout);
				takeDevWarns();
				if (!bytes) return;
				const whole = coverage.wholeRoots.map((root) => heldSpan(source, doc, layout, root));
				expect(checkRangeHoldsWhole(bytes, whole)).toBeNull();
			}),
			{ numRuns: 2000, seed: freshOrFixedSeed(826) }
		);
	});
});
