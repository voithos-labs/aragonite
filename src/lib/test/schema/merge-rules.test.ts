import { describe, it, expect } from 'vitest';
import { isMergeEligible, findMergeTarget, getMergeRole } from '../../schema/merge-rules';
import type { MergeRole } from '../../schema/block-kind-descriptor';
import { parse } from '../../core/parser';
import { ALL_BLOCK_KINDS, type BlockKind, type CstNode } from '../../core/nodes';
import { rebuildAncestryRaw } from '../../schema/container-raw';
import { serialize } from '../../core/serializer';

function parseBlock(src: string): CstNode {
	const doc = parse(src);
	return doc.children[0];
}

// Eligibility is a role-pair rule, never a kind rule (schema/merge-rules.ts), so one kind per
// role covers the whole matrix; which role each kind carries is pinned exhaustively in
// block-kind-descriptor.test.ts. `satisfies` fails a new role that gets no representative here.
const ROLE_SAMPLE = {
	prose: 'paragraph',
	'prose-absorber': 'heading',
	container: 'blockquote',
	'self-merge': 'unrecognized',
	'not-mergeable': 'fencedCode'
} as const satisfies Record<MergeRole, BlockKind>;

const MERGEABLE: ReadonlyArray<[MergeRole, MergeRole]> = [
	['prose', 'prose'],
	['prose-absorber', 'prose'],
	['container', 'prose'],
	['self-merge', 'self-merge']
];

describe('isMergeEligible — every ordered role pair', () => {
	const roles = Object.keys(ROLE_SAMPLE) as MergeRole[];

	// Non-vacuity: the matrix below is only about roles if its samples still carry them.
	it('each sample kind still carries the role it stands for', () => {
		for (const role of roles) {
			expect(getMergeRole(ROLE_SAMPLE[role]), ROLE_SAMPLE[role]).toBe(role);
		}
	});

	// Every real kind pair, answered against its role representative: a kind-keyed branch
	// inside the function diverges here by name, where the role matrix alone cannot see it.
	it('answers every built-in kind pair from its roles alone', () => {
		for (const prev of ALL_BLOCK_KINDS) {
			for (const curr of ALL_BLOCK_KINDS) {
				expect(isMergeEligible(prev, curr), `${prev}+${curr}`).toBe(
					isMergeEligible(ROLE_SAMPLE[getMergeRole(prev)], ROLE_SAMPLE[getMergeRole(curr)])
				);
			}
		}
	});

	for (const prev of roles) {
		for (const curr of roles) {
			const expected = MERGEABLE.some(([p, c]) => p === prev && c === curr);
			const verdict = expected ? 'mergeable' : 'NOT mergeable';
			it(`${prev} (${ROLE_SAMPLE[prev]}) + ${curr} (${ROLE_SAMPLE[curr]}) are ${verdict}`, () => {
				expect(isMergeEligible(ROLE_SAMPLE[prev], ROLE_SAMPLE[curr])).toBe(expected);
			});
		}
	}
});

describe('findMergeTarget', () => {
	it('prose prev (paragraph) returns prev itself with empty path', () => {
		const prev = parseBlock('hello\n');
		const result = findMergeTarget(prev);
		expect(result).not.toBeNull();
		expect(result!.target).toBe(prev);
		expect(result!.path).toEqual([]);
	});

	it('prose-absorber prev (heading) returns prev itself with empty path', () => {
		const prev = parseBlock('# Heading\n');
		const result = findMergeTarget(prev);
		expect(result).not.toBeNull();
		expect(result!.target).toBe(prev);
		expect(result!.path).toEqual([]);
	});

	it('single-paragraph blockquote returns inner paragraph with path [0]', () => {
		const prev = parseBlock('> hello\n');
		const result = findMergeTarget(prev);
		expect(result).not.toBeNull();
		expect(result!.target.kind).toBe('paragraph');
		expect((result!.target.raw ?? '').trim()).toBe('hello');
		expect(result!.path).toEqual([0]);
	});

	it('multi-paragraph blockquote returns last inner paragraph', () => {
		const prev = parseBlock('> first\n>\n> second\n');
		const result = findMergeTarget(prev);
		expect(result).not.toBeNull();
		expect((result!.target.raw ?? '').trim()).toBe('second');
		expect(result!.path).toEqual([1]);
	});

	it('nested blockquote returns deepest paragraph with exact path [0, 0]', () => {
		const prev = parseBlock('> > deep\n');
		const result = findMergeTarget(prev);
		expect(result).not.toBeNull();
		expect(result!.target.kind).toBe('paragraph');
		expect((result!.target.raw ?? '').trim()).toBe('deep');
		expect(result!.path).toEqual([0, 0]);
	});

	it('flat unordered list returns last item last paragraph', () => {
		const prev = parseBlock('- first\n- second\n');
		const result = findMergeTarget(prev);
		expect(result).not.toBeNull();
		expect(result!.target.kind).toBe('paragraph');
		expect((result!.target.raw ?? '').trim()).toBe('second');
		expect(result!.path).toEqual([1, 0]);
	});

	it('list with nested sub-list returns deepest nested paragraph', () => {
		const prev = parseBlock('- a\n  - b\n');
		const result = findMergeTarget(prev);
		expect(result).not.toBeNull();
		expect((result!.target.raw ?? '').trim()).toBe('b');
		expect(result!.path).toEqual([0, 1, 0, 0]);
	});

	it('blockquote with not-mergeable deepest leaf (fenced code) returns null', () => {
		const prev = parseBlock('> before\n>\n> ```\n> code\n> ```\n');
		const result = findMergeTarget(prev);
		expect(result).toBeNull();
	});

	it('thematic break as prev returns null (not-mergeable)', () => {
		const prev = parseBlock('---\n');
		const result = findMergeTarget(prev);
		expect(result).toBeNull();
	});
});

describe('findMergeTarget + rebuildAncestryRaw round-trip', () => {
	function simulateMerge(prevSrc: string, currText: string): string {
		const prev = parseBlock(prevSrc);
		const result = findMergeTarget(prev);
		if (!result) return prevSrc;
		const target = result.target;
		const raw = target.raw ?? '';
		const lineEnding = raw.endsWith('\r\n') ? '\r\n' : '\n';
		const targetText = raw.replace(/\r?\n$/, '');
		target.raw = targetText + currText + lineEnding;
		if (result.path.length > 0) {
			rebuildAncestryRaw(prev, result.path);
		}
		return serialize({ children: [prev], prefix: '', suffix: '' });
	}

	it('flat blockquote: serialize returns the expected post-merge source', () => {
		const result = simulateMerge('> text\n', 'text2');
		expect(result).toBe('> texttext2\n');
	});

	it('multi-paragraph blockquote: only the last paragraph is mutated', () => {
		const result = simulateMerge('> first\n>\n> second\n', 'text');
		expect(result).toBe('> first\n>\n> secondtext\n');
	});

	it('nested blockquote: innermost paragraph receives the merge and both levels rebuild', () => {
		const result = simulateMerge('> > deep\n', 'text');
		expect(result).toContain('> > deeptext');
	});

	it('flat list: last item last paragraph receives the merge', () => {
		const result = simulateMerge('- first\n- second\n', 'text');
		expect(result).toBe('- first\n- secondtext\n');
	});

	it('nested list: deepest nested item receives the merge, ancestry rebuilds correctly', () => {
		const result = simulateMerge('- a\n  - b\n', 'text');
		expect(result).toBe('- a\n  - btext\n');
	});

	it('blockquote with not-mergeable deepest leaf: simulateMerge returns unchanged (walker returned null)', () => {
		const input = '> para\n>\n> ```\n> code\n> ```\n';
		const result = simulateMerge(input, 'text');
		expect(result).toBe(input);
	});
});
