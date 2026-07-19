import { describe, it, expect } from 'vitest';
import { scanInline } from '../../../../core/inline/scan';
import {
	assertConstructCoverage,
	assertTotalCoverage,
	describeScanCases,
	emphasisNode,
	shapeOf,
	textNode
} from './scan-test-helpers';

describe('multiple-of-3 rule (CommonMark §6.2)', () => {
	it('nested run produces emphasis wrapping strong, not a flat pair', () => {
		const source = 'foo***bar***baz';
		const nodes = scanInline(source, 0, source.length);
		assertConstructCoverage(nodes);
		const em = nodes.find((n) => n.kind === 'emphasis');
		expect(em).toBeDefined();
		expect(em!.children?.some((c) => c.kind === 'strong')).toBe(true);
	});

	it('asymmetric run leaves the surplus inner delimiter literal', () => {
		// `**foo*bar**baz*` — the inner `*` cannot pair across the `**` close
		// under the multiple-of-3 rule, so it survives as text inside the strong.
		const source = '**foo*bar**baz*';
		const nodes = scanInline(source, 0, source.length);
		assertConstructCoverage(nodes);
		const strong = nodes.find((n) => n.kind === 'strong');
		expect(strong).toBeDefined();
		expect(strong!.children?.some((c) => c.kind === 'text' && c.text === '*')).toBe(true);
		// The trailing `*baz*` after the strong stays literal (no second emphasis).
		expect(nodes.filter((n) => n.kind === 'emphasis')).toHaveLength(0);
	});

	// The rule applies to ORIGINAL delimiter-run lengths, not the still-unconsumed
	// remainder after partial matches (commonmark.js `origdelims`). Shapes mined
	// from a brute-force diff against commonmark.js 0.31.2, each with a distinct
	// opener/closer decay pattern.
	const originalRunLengthCases = [
		{ source: 'x**y*z****w', shape: 'x**y<em>z</em>***w' },
		{ source: 'a***a****', shape: 'a<em><strong>a</strong></em>*' },
		{ source: '*a***a*', shape: '<em>a</em>*<em>a</em>' },
		{ source: '**a****a*', shape: '**a***<em>a</em>' },
		{ source: 'a*a *a**', shape: 'a*a <em>a</em>*' },
		{ source: 'a*a *a***', shape: 'a<em>a <em>a</em></em>*' }
	];

	for (const { source, shape } of originalRunLengthCases) {
		it(`gates on original run lengths: ${JSON.stringify(source)}`, () => {
			const nodes = scanInline(source, 0, source.length);
			assertTotalCoverage(nodes, 0, source.length);
			assertConstructCoverage(nodes);
			expect(shapeOf(nodes, source)).toBe(shape);
		});
	}
});

describeScanCases('partial consumption', [
	[
		'**a* pairs one star and leaves one literal *',
		'**a*',
		[textNode(0, 1, '*'), emphasisNode(1, 4, [textNode(2, 3, 'a')])]
	],
	[
		'*a** leaves the trailing surplus literal',
		'*a**',
		[emphasisNode(0, 3, [textNode(1, 2, 'a')]), textNode(3, 4, '*')]
	]
]);

describe('openers_bottom (§6.2 phase 2 optimization)', () => {
	it('pathological unmatched closers stay linear', () => {
		// 150k `_` openers interleaved with 150k `*` closers that can never match:
		// without the openers_bottom lower bound every closer re-walks the whole
		// opener stack (quadratic, ~10^10 steps — tens of seconds); with it each
		// failed search is amortized O(1). The generous bound fails the quadratic
		// shape on any machine while leaving the linear one two-plus orders of
		// magnitude of room.
		const raw = '_a* '.repeat(150000);
		const startedAt = performance.now();
		const nodes = scanInline(raw, 0, raw.length);
		const elapsed = performance.now() - startedAt;
		assertTotalCoverage(nodes, 0, raw.length);
		expect(nodes).toEqual([textNode(0, raw.length, raw)]);
		expect(elapsed).toBeLessThan(2000);
	});
});
