import { describe, it, expect } from 'vitest';
import { Node } from 'commonmark';
import { parseInline } from '../../core/inline';
import type { InlineNode } from '../../core/nodes';
import { referenceInlineNodes } from './reference';
import { normalizeAragonite, normalizeReference, normalEqual, type NormalNode } from './normalize';

// ── The mini-differ: both parsers → common shape → equal ─────────────────────

/**
 * Inputs where aragonite and commonmark are known to agree, so a failure pins the
 * normalizer, not parser divergence. The shape row catches a bug that breaks both sides.
 */
const CONVERGENT: Array<{ name: string; md: string; shape: NormalNode[] }> = [
	{ name: 'plain text', md: 'hello world', shape: [{ kind: 'text', text: 'hello world' }] },
	{ name: 'escape → char', md: 'a\\*b', shape: [{ kind: 'text', text: 'a*b' }] },
	{ name: 'entity → decoded', md: '&copy;', shape: [{ kind: 'text', text: '©' }] },
	{ name: 'softbreak merges', md: 'a\nb', shape: [{ kind: 'text', text: 'a\nb' }] },
	{ name: 'code span', md: '`code`', shape: [{ kind: 'code', text: 'code' }] },
	{
		name: 'emphasis',
		md: '*a*',
		shape: [{ kind: 'emphasis', children: [{ kind: 'text', text: 'a' }] }]
	},
	{
		name: 'nested emphasis recurses',
		md: '**a *b* c**',
		shape: [
			{
				kind: 'strong',
				children: [
					{ kind: 'text', text: 'a ' },
					{ kind: 'emphasis', children: [{ kind: 'text', text: 'b' }] },
					{ kind: 'text', text: ' c' }
				]
			}
		]
	},
	{
		name: 'autolink → link with label child',
		md: '<https://x.y>',
		shape: [{ kind: 'link', url: 'https://x.y', children: [{ kind: 'text', text: 'https://x.y' }] }]
	},
	{
		name: 'image alt → text child, no title',
		md: '![cat](/img.png)',
		shape: [{ kind: 'image', url: '/img.png', children: [{ kind: 'text', text: 'cat' }] }]
	},
	{
		name: 'untitled link coalesces empty title',
		md: '[a](/u)',
		shape: [{ kind: 'link', url: '/u', children: [{ kind: 'text', text: 'a' }] }]
	},
	{
		name: 'titled link keeps title',
		md: '[a](/u "t")',
		shape: [{ kind: 'link', url: '/u', title: 't', children: [{ kind: 'text', text: 'a' }] }]
	},
	{
		name: 'raw html',
		md: '<b>x</b>',
		shape: [
			{ kind: 'html', text: '<b>' },
			{ kind: 'text', text: 'x' },
			{ kind: 'html', text: '</b>' }
		]
	},
	{
		name: 'hard break',
		md: 'line  \nbreak',
		shape: [{ kind: 'text', text: 'line' }, { kind: 'hardbreak' }, { kind: 'text', text: 'break' }]
	}
];

/** Both parsers' normal forms match `shape` exactly and compare equal. */
function expectBothNormalizeTo(md: string, shape: NormalNode[]): void {
	const ours = normalizeAragonite(parseInline(md, 0, md.length), md);
	const refNodes = referenceInlineNodes(md);
	expect(refNodes).not.toBeNull();
	const ref = normalizeReference(refNodes!);

	expect(ours).toEqual(shape);
	expect(ref).toEqual(shape);
	expect(normalEqual(ours, ref)).toBe(true);
}

describe('normalize (dual-parser mini-differ)', () => {
	for (const { name, md, shape } of CONVERGENT) {
		it(`${name}: both parsers agree and match the shape`, () => {
			expectBothNormalizeTo(md, shape);
		});
	}
});

// ── Reconciliations (audited: baseline.json normalizerReconciliations) ───────

/**
 * Divergences reconciled by folding the ARAGONITE side to the spec-semantic form the
 * reference already carries (§6.1, §6.8). The shape must equal the reference's
 * untransformed one, since folding that side too would double-strip.
 */
const RECONCILED: Array<{ name: string; md: string; shape: NormalNode[] }> = [
	{
		name: 'code span: one flanking space stripped',
		md: '` * `',
		shape: [{ kind: 'code', text: '*' }]
	},
	{
		name: 'code span: double flanking spaces lose exactly one, not two',
		md: '`  a  `',
		shape: [{ kind: 'code', text: ' a ' }]
	},
	{
		name: 'code span: line endings fold to spaces before the strip',
		md: '``\nfoo\n``',
		shape: [{ kind: 'code', text: 'foo' }]
	},
	{
		name: 'softbreak: one trailing space trimmed (not a hard break)',
		md: 'a \nb',
		shape: [{ kind: 'text', text: 'a\nb' }]
	},
	{
		name: 'both rules in one input',
		md: "<[&\u{10100} \n`_中\n]'`ab",
		shape: [
			{ kind: 'text', text: '<[&\u{10100}\n' },
			{ kind: 'code', text: "_中 ]'" },
			{ kind: 'text', text: 'ab' }
		]
	}
];

/** Edges the reconciliation must NOT touch (spec §6.1 / §6.8 boundaries). */
const PRESERVED: Array<{ name: string; md: string; shape: NormalNode[] }> = [
	{
		name: 'all-space code span keeps every space',
		md: '`   `',
		shape: [{ kind: 'code', text: '   ' }]
	},
	{
		name: 'two-space line ending stays a hard break',
		md: 'a  \nb',
		shape: [{ kind: 'text', text: 'a' }, { kind: 'hardbreak' }, { kind: 'text', text: 'b' }]
	},
	{
		name: 'tab before a softbreak is content (reference strips spaces only)',
		md: 'a\t\nb',
		shape: [{ kind: 'text', text: 'a\t\nb' }]
	}
];

describe('reconciliations (code-span folding, softbreak trimming)', () => {
	for (const { name, md, shape } of RECONCILED) {
		it(`${name}: both sides reach the reconciled shape`, () => {
			expectBothNormalizeTo(md, shape);
		});
	}

	for (const { name, md, shape } of PRESERVED) {
		it(`${name}: reconciliation leaves the shape alone`, () => {
			expectBothNormalizeTo(md, shape);
		});
	}

	it('genuine interior code-content mismatch still fails normalEqual', () => {
		const ours = normalizeAragonite(parseInline('`a  b`', 0, 6), '`a  b`');
		const theirs = normalizeReference(referenceInlineNodes('`a b`')!);
		expect(normalEqual(ours, theirs)).toBe(false);
	});

	it('single-sided flanking space is content, not stripped', () => {
		const ours = normalizeAragonite(parseInline('` a`', 0, 4), '` a`');
		const theirs = normalizeReference(referenceInlineNodes('`a`')!);
		expect(normalEqual(ours, theirs)).toBe(false);
	});

	it('genuine text-content mismatch still fails normalEqual after trimming', () => {
		const ours = normalizeAragonite(parseInline('y \nb', 0, 4), 'y \nb');
		const theirs = normalizeReference(referenceInlineNodes('x\nb')!);
		expect(normalEqual(ours, theirs)).toBe(false);
	});
});

// ── Canonicalization ─────────────────────────────────────────────────────────

describe('canonicalization', () => {
	it('drops empty text and merges adjacent text, recursively', () => {
		const nodes: InlineNode[] = [
			{ kind: 'text', start: 0, end: 1, text: 'a' },
			{ kind: 'text', start: 1, end: 1, text: '' },
			{ kind: 'text', start: 1, end: 2, text: 'b' },
			{
				kind: 'emphasis',
				start: 2,
				end: 3,
				children: [
					{ kind: 'text', start: 0, end: 1, text: 'x' },
					{ kind: 'text', start: 0, end: 0, text: '' },
					{ kind: 'text', start: 0, end: 1, text: 'y' }
				]
			}
		];
		expect(normalizeAragonite(nodes, 'ab*')).toEqual([
			{ kind: 'text', text: 'ab' },
			{ kind: 'emphasis', children: [{ kind: 'text', text: 'xy' }] }
		]);
	});
});

// ── normalEqual ──────────────────────────────────────────────────────────────

describe('normalEqual', () => {
	it('is false on text, kind, length, and nested differences', () => {
		expect(normalEqual([{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }])).toBe(false);
		expect(normalEqual([{ kind: 'emphasis' }], [{ kind: 'strong' }])).toBe(false);
		expect(normalEqual([{ kind: 'text', text: 'a' }], [])).toBe(false);
		expect(
			normalEqual(
				[{ kind: 'emphasis', children: [{ kind: 'text', text: 'a' }] }],
				[{ kind: 'emphasis', children: [{ kind: 'text', text: 'b' }] }]
			)
		).toBe(false);
	});
});

// ── Unmapped-node throws ─────────────────────────────────────────────────────

describe('unmapped nodes throw', () => {
	it('rejects strikethrough on our side (corpus excludes ~)', () => {
		const strike: InlineNode = { kind: 'strikethrough', start: 0, end: 2, children: [] };
		expect(() => normalizeAragonite([strike], '')).toThrow(/strikethrough/);
	});

	it('rejects an unmapped commonmark type', () => {
		expect(() => normalizeReference([new Node('thematic_break')])).toThrow(/thematic_break/);
	});
});
