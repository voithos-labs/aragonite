import { beforeEach, describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';
import { DIRECTIVE_CONTAINER } from '$lib/core/directive/kinds';
import { expectBoundedGrowth, measureScanGrowth } from '../../harness/scan-growth';

beforeEach(activateDirectiveGrammar);

const parseOnly = (source: string) => void parse(source);

// Without the directive grammar every opener is prose, and the bounds below measure the paragraph.
it('reads an opener as a directive container', () => {
	expect(parse(':::a\nx\n:::\n').children[0].kind).toBe(DIRECTIVE_CONTAINER);
});

// A flood of unclosed container openers can forward-scan to EOF per opener, O(n^2). Measured as
// the N-versus-4N ratio, so the bound does not depend on the machine.

describe('directive container-opener bounds (ADV-2)', () => {
	it('an unclosed-opener flood parses within a bounded growth ratio and round-trips', () => {
		const growth = measureScanGrowth(parseOnly, ':::a\n', [8, 32]);
		expectBoundedGrowth(growth);

		const source = ':::a\n'.repeat(2_500);
		expect(serialize(parse(source))).toBe(source);
	}, 300_000);
});

// One step below the flood above: when every closer-shaped line is shorter than its
// openers the lookup never matches, so an unbounded scan revisits every closer per opener.
describe('directive closer lookup bounds', () => {
	it('stays bounded when no closer is long enough to close any opener', () => {
		const growth = measureScanGrowth(parseOnly, ':::a\n:\n', [16, 64]);
		expectBoundedGrowth(growth);
	}, 120_000);

	it('round-trips the unclosable shape byte-for-byte', () => {
		const source = ':::a\n:\n'.repeat(500);
		expect(serialize(parse(source))).toBe(source);
	});
});
