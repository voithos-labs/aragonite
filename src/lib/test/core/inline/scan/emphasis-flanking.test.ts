import { describe, it, expect } from 'vitest';
import type { InlineNode } from '../../../../core/nodes';
import { scanInline } from '../../../../core/inline/scan';
import {
	assertConstructCoverage,
	assertTotalCoverage,
	collectKind,
	hasKind
} from './scan-test-helpers';
import {
	type FlankingCase,
	FLANKING_CASES,
	INTRA_WORD_UNDERSCORE_CASES
} from '../../../support/flanking-corpus';

// The §6.2 corpus is single-sourced in test/support/flanking-corpus.ts and run
// here against scanInline; inline-conformance.test.ts runs the same cases through
// the full parseInline pipeline. Same corpus, different SUT — never drift.

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
				assertConstructCoverage(nodes);
				expect(sortedSpans(nodes, source)).toEqual(runs!.slice().sort());
			});
		}
	});
}

describeFlankingCases('flanking (CommonMark §6.2)', FLANKING_CASES, false);

describeFlankingCases(
	'intra-word underscore suppression (CommonMark §6.2)',
	INTRA_WORD_UNDERSCORE_CASES,
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
