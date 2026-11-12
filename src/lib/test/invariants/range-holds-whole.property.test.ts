// G1.212: a range read as bytes spans every block its coverage holds whole, and ends a leaf held
// whole at its last character, over the documents and ranges the range laws draw. Miss-analysis:
// the laws compare a copy with a removal, both read their bytes in one place, so a range wrong for
// both agreed with itself.

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

const OPEN = 'abc\n\n<details open>\n<summary>Sum</summary>\n\n---\n\nbody\n\n</details>\n';

/** Title rows a range holds whole on their own, which the law corpus rarely draws. */
const TITLE_ROW_DOCUMENTS = [
	OPEN,
	OPEN.replace(/\n/g, '\r\n'),
	'# h\n\n:::note T\n---\n\nbody\n:::\n'
];

const arbDocument = fc.oneof(
	{ arbitrary: arbLawDocument, weight: 9 },
	{ arbitrary: fc.constantFrom(...TITLE_ROW_DOCUMENTS), weight: 1 }
);

/** A block's span off the layout, except a leaf whose bytes hold more than its text (a title row
 *  inside its container's tags), whose end the parser-only position map reads. */
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
		const later = [
			{ from: 0, to: 49 },
			{ from: 52, to: 70 }
		];
		expect(checkRangeHoldsWhole({ from: 0, to: 60 }, later)?.message).toContain('[52, 70)');
	});

	it('over the law corpus', () => {
		installPlugins(SYNTAX_PLUGINS);
		fc.assert(
			fc.property(arbDocument, arbRangeSeed, (source, seed) => {
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
				// Past a held leaf's last character, the rest of its line is its container's.
				coverage.wholeRoots.forEach((root, i) => {
					if (blockNodeAt(doc, root)!.children?.length) return;
					const nextLine = source.indexOf('\n', whole[i].to) + 1 || source.length + 1;
					const inLine = bytes.to > whole[i].to && bytes.to < nextLine;
					expect(inLine, `the range ends in the rest of [${root}]'s line`).toBe(false);
				});
			}),
			{ numRuns: 2000, seed: freshOrFixedSeed(826) }
		);
	});
});
