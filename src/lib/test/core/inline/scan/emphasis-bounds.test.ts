import { describe, it, expect } from 'vitest';
import { parseInline } from '../../../../core/inline';
import { BOUNDED_GROWTH_CEILING, measureScanGrowth } from '../../../harness/scan-growth';
import { assertConstructCoverage, assertTotalCoverage, collectKind } from './scan-test-helpers';

const scan = (raw: string) => parseInline(raw, 0, raw.length);

// The pairing algorithm is already amortized (openers_bottom); only the list surgery that
// splices a pair's interior out grows, at O(pairs^2) on a paragraph of nothing but pairs.
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

	// Two marker characters per side go through the same surgery, so a bound that held only
	// for the one-character run would miss a regression in the two-character path.
	it('a strong and strikethrough flood scans within a bounded growth ratio', () => {
		const { times, ratio } = measureScanGrowth(scan, '**a** ~~b~~ ', [24, 96]);
		expect(ratio, `24KB=${times[0].toFixed(1)}ms 96KB=${times[1].toFixed(1)}ms`).toBeLessThan(
			BOUNDED_GROWTH_CEILING
		);
	}, 300_000);

	// A `]` resolves the emphasis inside its label, so this row catches a per-pass setup
	// cost scaled to the whole working list instead of to the label.
	it('emphasis nested in a link flood scans within a bounded growth ratio', () => {
		const { times, ratio } = measureScanGrowth(scan, '[*a*](u) ', [24, 96]);
		expect(ratio, `24KB=${times[0].toFixed(1)}ms 96KB=${times[1].toFixed(1)}ms`).toBeLessThan(
			BOUNDED_GROWTH_CEILING
		);
	}, 300_000);

	// A faster scan that drops or mis-nests pairs is not a fix. The separator matters: an
	// unspaced `*a*` abuts into shared `**` runs instead of one pair per repetition.
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
