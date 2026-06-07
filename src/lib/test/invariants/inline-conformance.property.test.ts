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

function isAllPlainText(nodes: InlineNode[]): boolean {
	return nodes.every((n) => n.kind === 'text');
}

describe('G2.3 emphasis flanking (CommonMark §6.2)', () => {
	const cases: { name: string; source: string; emphasis: boolean }[] = [
		// Left-flanking opener requires a non-whitespace char after the run.
		{ name: 'opener followed by space cannot open', source: '* foo*', emphasis: false },
		{ name: 'closer preceded by space cannot close', source: '*foo *', emphasis: false },
		{ name: 'tight run emphasizes', source: '*foo*', emphasis: true },
		// `*` permits intra-word emphasis (no punctuation restriction).
		{ name: 'intra-word * emphasizes', source: 'foo*bar*baz', emphasis: true },
		// Punctuation-flanking: a run between punctuation can still pair.
		{ name: 'run surrounded by punctuation pairs', source: '*(*foo*)*', emphasis: true }
	];

	for (const { name, source, emphasis } of cases) {
		it(`${name}: ${JSON.stringify(source)}`, () => {
			const nodes = parseInline(source, 0, source.length);
			expect(hasKind(nodes, 'emphasis') || hasKind(nodes, 'strong')).toBe(emphasis);
		});
	}
});

describe('G2.3 intra-word underscore suppression (CommonMark §6.2)', () => {
	const cases: { name: string; source: string; emphasis: boolean }[] = [
		{ name: 'intra-word _ stays literal', source: 'foo_bar_baz', emphasis: false },
		{ name: 'opening _ mid-word cannot open', source: '_foo_bar', emphasis: false },
		{ name: 'closing _ mid-word cannot close', source: 'foo bar_baz_', emphasis: false },
		{ name: '_ with whitespace boundaries emphasizes', source: 'foo _bar_ baz', emphasis: true },
		{ name: '_ after punctuation can open', source: '(_foo_)', emphasis: true }
	];

	for (const { name, source, emphasis } of cases) {
		it(`${name}: ${JSON.stringify(source)}`, () => {
			const nodes = parseInline(source, 0, source.length);
			expect(hasKind(nodes, 'emphasis')).toBe(emphasis);
			if (!emphasis) expect(isAllPlainText(nodes)).toBe(true);
		});
	}
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
});
