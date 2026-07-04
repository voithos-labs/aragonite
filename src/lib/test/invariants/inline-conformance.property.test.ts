import { describe, it, expect } from 'vitest';
import type { InlineNode } from '../../core/nodes';
import { parseInline } from '../../core/inline';

// G2.3: subtle CommonMark/GFM emphasis rules — left/right flanking, the
// multiple-of-3 rule, and intra-word `_` suppression. Reference forms,
// autolink §6.9 trimming, and basic emphasis already have example coverage in
// test/core/inline/**; this corpus targets only the flanking-algorithm edges
// those tests don't reach.

function hasKind(nodes: InlineNode[], kind: InlineNode['kind']): boolean {
	for (const n of nodes) {
		if (n.kind === kind) return true;
		if (n.children && hasKind(n.children, kind)) return true;
	}
	return false;
}

function collectKind(nodes: InlineNode[], kind: InlineNode['kind']): InlineNode[] {
	const out: InlineNode[] = [];
	for (const n of nodes) {
		if (n.kind === kind) out.push(n);
		if (n.children) out.push(...collectKind(n.children, kind));
	}
	return out;
}

function isAllPlainText(nodes: InlineNode[]): boolean {
	return nodes.every((n) => n.kind === 'text');
}

/** Node tree rendered as an `<em>`/`<strong>`-tagged shape string for exact pins. */
function shapeOf(nodes: InlineNode[], source: string): string {
	return nodes
		.map((n) => {
			if (n.kind === 'emphasis') return `<em>${shapeOf(n.children ?? [], source)}</em>`;
			if (n.kind === 'strong') return `<strong>${shapeOf(n.children ?? [], source)}</strong>`;
			return source.slice(n.start, n.end);
		})
		.join('');
}

// Positive cases pin the exact set of emphasized runs (markers included):
// asserting the full set, not mere presence, fails a parser that emphasizes the
// wrong span, drops a nested pair, or invents a spurious one.
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

describe('G2.3 emphasis flanking (CommonMark §6.2)', () => {
	const cases: FlankingCase[] = [
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
	];

	for (const { name, source, emphasis, runs } of cases) {
		it(`${name}: ${JSON.stringify(source)}`, () => {
			const nodes = parseInline(source, 0, source.length);
			if (!emphasis) {
				expect(hasKind(nodes, 'emphasis') || hasKind(nodes, 'strong')).toBe(false);
				return;
			}
			expect(sortedSpans(nodes, source)).toEqual(runs!.slice().sort());
		});
	}
});

describe('G2.3 intra-word underscore suppression (CommonMark §6.2)', () => {
	const cases: FlankingCase[] = [
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
	];

	for (const { name, source, emphasis, runs } of cases) {
		it(`${name}: ${JSON.stringify(source)}`, () => {
			const nodes = parseInline(source, 0, source.length);
			if (!emphasis) {
				expect(hasKind(nodes, 'emphasis')).toBe(false);
				expect(isAllPlainText(nodes)).toBe(true);
				return;
			}
			expect(sortedSpans(nodes, source)).toEqual(runs!.slice().sort());
		});
	}
});

describe('G2.3 astral punctuation flanking (code points, not UTF-16 units)', () => {
	it('astral punctuation neighbors flank like BMP punctuation', () => {
		// U+10100 (AEGEAN WORD SEPARATOR LINE, category Po) must flank like `.`:
		// `._x_.` emphasizes, so this must too. Reading UTF-16 units instead of
		// code points classifies the lone surrogate as "other" and drops the pair.
		const source = '\u{10100}_x_\u{10100}';
		const nodes = parseInline(source, 0, source.length);
		expect(sortedSpans(nodes, source)).toEqual(['_x_']);
	});
});

describe('G2.3 multiple-of-3 rule (CommonMark §6.2)', () => {
	it('nested run produces emphasis wrapping strong, not a flat pair', () => {
		const source = 'foo***bar***baz';
		const nodes = parseInline(source, 0, source.length);
		const em = nodes.find((n) => n.kind === 'emphasis');
		expect(em).toBeDefined();
		expect(em!.children?.some((c) => c.kind === 'strong')).toBe(true);
	});

	it('asymmetric run leaves the surplus inner delimiter literal', () => {
		// `**foo*bar**baz*` — the inner `*` cannot pair across the `**` close
		// under the multiple-of-3 rule, so it survives as text inside the strong.
		const source = '**foo*bar**baz*';
		const nodes = parseInline(source, 0, source.length);
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
			const nodes = parseInline(source, 0, source.length);
			expect(shapeOf(nodes, source)).toBe(shape);
		});
	}
});
