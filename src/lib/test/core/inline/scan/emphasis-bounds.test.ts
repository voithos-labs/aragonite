import { describe, it, expect } from 'vitest';
import { parseInline } from '../../../../core/inline';
import { BOUNDED_GROWTH_CEILING, measureScanGrowth } from '../../../harness/scan-growth';
import { assertConstructCoverage, assertTotalCoverage, collectKind } from './scan-test-helpers';

const scan = (raw: string) => parseInline(raw, 0, raw.length);

// An emphasis pair is resolved by splicing its interior out of the working node
// list. Locating the pair's two run nodes in that list, and moving the tail past
// them, are both O(list) — so a paragraph that is nothing but pairs costs
// O(pairs^2), seconds on one pasted block. The pairing algorithm itself is
// already amortized (openers_bottom); only the list surgery grows.
describe('emphasis pairing bounds', () => {
	it('a pair flood scans within a bounded growth ratio at both 4x steps', () => {
		const small = measureScanGrowth(scan, '*a*', [6, 24]);
		const large = measureScanGrowth(scan, '*a*', [24, 96]);
		expect(
			small.ratio,
			`6KB=${small.times[0].toFixed(1)}ms 24KB=${small.times[1].toFixed(1)}ms`
		).toBeLessThan(BOUNDED_GROWTH_CEILING);
		expect(
			large.ratio,
			`24KB=${large.times[0].toFixed(1)}ms 96KB=${large.times[1].toFixed(1)}ms`
		).toBeLessThan(BOUNDED_GROWTH_CEILING);
	}, 300_000);

	// Strong and strikethrough consume two marker characters per side and pair
	// through the same surgery, so they need their own row: a bound that held only
	// for the one-character run would miss a regression in the two-character path.
	it('a strong and strikethrough flood scans within a bounded growth ratio', () => {
		const { times, ratio } = measureScanGrowth(scan, '**a** ~~b~~ ', [24, 96]);
		expect(ratio, `24KB=${times[0].toFixed(1)}ms 96KB=${times[1].toFixed(1)}ms`).toBeLessThan(
			BOUNDED_GROWTH_CEILING
		);
	}, 300_000);

	// A `]` resolves the emphasis inside its label, so this shape pays the pass's
	// setup once per link rather than once per block — the row that would catch a
	// per-pass cost scaled to the whole working list instead of the label.
	it('emphasis nested in a link flood scans within a bounded growth ratio', () => {
		const { times, ratio } = measureScanGrowth(scan, '[*a*](u) ', [24, 96]);
		expect(ratio, `24KB=${times[0].toFixed(1)}ms 96KB=${times[1].toFixed(1)}ms`).toBeLessThan(
			BOUNDED_GROWTH_CEILING
		);
	}, 300_000);

	// A faster scan that drops or mis-nests pairs is not a fix. Asserted at a size
	// the growth rows actually run, since the surgery only misbehaves in bulk. The
	// separator matters: the growth rows' `*a*` abuts into shared `**` runs, so
	// only a spaced unit yields one independent pair per repetition.
	it('claims every pair in a flood with markers and interiors intact', () => {
		const pairs = 20_000;
		const raw = '*a* '.repeat(pairs);
		const nodes = scan(raw);
		assertTotalCoverage(nodes, 0, raw.length);
		assertConstructCoverage(nodes);
		expect(collectKind(nodes, 'emphasis')).toHaveLength(pairs);
		expect(nodes.filter((n) => n.kind !== 'emphasis').every((n) => n.kind === 'text')).toBe(true);
	}, 120_000);

	// Nesting shares the same splice: an inner pair's wrap node must land back in
	// the list where the outer pair can still collect it as a child.
	it('nests a pair flood without losing a level', () => {
		const depth = 2000;
		const raw = '*'.repeat(depth) + 'x' + '*'.repeat(depth);
		const nodes = scan(raw);
		assertTotalCoverage(nodes, 0, raw.length);
		assertConstructCoverage(nodes);
		// Runs of `depth` collapse into strong pairs from the inside out, plus one
		// emphasis when the run length is odd.
		expect(collectKind(nodes, 'strong')).toHaveLength(Math.floor(depth / 2));
		expect(collectKind(nodes, 'emphasis')).toHaveLength(depth % 2);
	}, 120_000);
});
