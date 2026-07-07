import { describe, it, expect } from 'vitest';
import type { InlineNode } from '../../core/nodes';
import { scanInline } from '../../core/inline/scan';
import {
	assertEmphasisCoverage,
	assertTotalCoverage,
	collectKind,
	hasKind
} from './scan-test-helpers';

// FlankingCase tables ported from test/invariants/inline-conformance.property.test.ts
// (G2.3) against scanInline — same corpus, same assertions: positives pin the
// exact set of emphasized runs (markers included), negatives pin no emphasis.

interface FlankingCase {
	name: string;
	source: string;
	emphasis: boolean;
	runs?: string[];
}

const sortedSpans = (nodes: InlineNode[], source: string): string[] =>
	collectKind(nodes, 'emphasis')
		.map((n) => source.slice(n.start, n.end))
		.sort();

function describeFlankingCases(
	family: string,
	cases: FlankingCase[],
	negativesAllText: boolean
): void {
	describe(family, () => {
		for (const { name, source, emphasis, runs } of cases) {
			it(`${name}: ${JSON.stringify(source)}`, () => {
				const nodes = scanInline(source, 0, source.length);
				assertTotalCoverage(nodes, 0, source.length);
				if (!emphasis) {
					expect(hasKind(nodes, 'emphasis') || hasKind(nodes, 'strong')).toBe(false);
					if (negativesAllText) expect(nodes.every((n) => n.kind === 'text')).toBe(true);
					return;
				}
				assertEmphasisCoverage(nodes);
				expect(sortedSpans(nodes, source)).toEqual(runs!.slice().sort());
			});
		}
	});
}

describeFlankingCases(
	'flanking (CommonMark §6.2)',
	[
		// Left-flanking opener requires a non-whitespace char after the run.
		{ name: 'opener followed by space cannot open', source: '* foo*', emphasis: false },
		{ name: 'closer preceded by space cannot close', source: '*foo *', emphasis: false },
		{ name: 'tight run emphasizes', source: '*foo*', emphasis: true, runs: ['*foo*'] },
		// `*` permits intra-word emphasis (no punctuation restriction).
		{ name: 'intra-word * emphasizes', source: 'foo*bar*baz', emphasis: true, runs: ['*bar*'] },
		// Punctuation-flanking: both the outer and inner runs pair.
		{
			name: 'run surrounded by punctuation pairs',
			source: '*(*foo*)*',
			emphasis: true,
			runs: ['*(*foo*)*', '*foo*']
		}
	],
	false
);

describeFlankingCases(
	'intra-word underscore suppression (CommonMark §6.2)',
	[
		{ name: 'intra-word _ stays literal', source: 'foo_bar_baz', emphasis: false },
		{ name: 'opening _ mid-word cannot open', source: '_foo_bar', emphasis: false },
		{ name: 'closing _ mid-word cannot close', source: 'foo bar_baz_', emphasis: false },
		{
			name: '_ with whitespace boundaries emphasizes',
			source: 'foo _bar_ baz',
			emphasis: true,
			runs: ['_bar_']
		},
		{ name: '_ after punctuation can open', source: '(_foo_)', emphasis: true, runs: ['_foo_'] }
	],
	true
);

describe('astral punctuation flanking (code points, not UTF-16 units)', () => {
	it('astral punctuation neighbors flank like BMP punctuation', () => {
		// U+10100 (AEGEAN WORD SEPARATOR LINE, category Po) must flank like `.`:
		// `._x_.` emphasizes, so this must too. Reading UTF-16 units instead of
		// code points classifies the lone surrogate as "other" and drops the pair.
		const source = '\u{10100}_x_\u{10100}';
		const nodes = scanInline(source, 0, source.length);
		assertTotalCoverage(nodes, 0, source.length);
		expect(sortedSpans(nodes, source)).toEqual(['_x_']);
	});
});
