import { describe, it, expect } from 'vitest';
import { isMergeEligible, findMergeTarget } from '../../schema/merge-rules';
import { parse } from '../../core/parser';
import type { BlockKind, CstNode } from '../../core/nodes';
import { rebuildAncestryRaw } from '../../schema/container-raw';
import { serialize } from '../../core/serializer';

describe('isMergeEligible', () => {
	const eligible: [string, string][] = [
		['paragraph', 'paragraph'],
		['heading', 'paragraph'],
		['setextHeading', 'paragraph'],
		['blockquote', 'paragraph'],
		['list', 'paragraph'],
		['listItem', 'paragraph'],
		['unrecognized', 'unrecognized']
	];

	for (const [a, b] of eligible) {
		it(`${a} + ${b} are mergeable`, () => {
			expect(isMergeEligible(a as BlockKind, b as BlockKind)).toBe(true);
		});
	}

	const ineligible: [string, string][] = [
		['paragraph', 'heading'],
		['paragraph', 'setextHeading'],
		['heading', 'heading'],
		['heading', 'setextHeading'],
		['setextHeading', 'heading'],
		['paragraph', 'blockquote'],
		['paragraph', 'list'],
		['heading', 'blockquote'],
		['blockquote', 'blockquote'],
		['blockquote', 'list'],
		['list', 'list'],
		['list', 'blockquote'],
		['list', 'listItem'],
		['blockquote', 'heading'],
		['list', 'heading'],
		['list', 'setextHeading'],
		['fencedCode', 'paragraph'],
		['fencedCode', 'fencedCode'],
		['thematicBreak', 'paragraph'],
		['indentedCode', 'paragraph'],
		['htmlBlock', 'paragraph'],
		['linkReferenceDefinition', 'paragraph'],
		['table', 'paragraph'],
		['tableRow', 'paragraph'],
		['tableCell', 'paragraph'],
		['paragraph', 'fencedCode'],
		['paragraph', 'thematicBreak'],
		['paragraph', 'table'],
		['paragraph', 'tableRow'],
		['paragraph', 'tableCell'],
		['table', 'table'],
		['tableRow', 'tableRow'],
		['tableCell', 'tableCell'],
		['table', 'tableRow'],
		['tableRow', 'tableCell'],
		['heading', 'fencedCode'],
		['blockquote', 'fencedCode'],
		['unrecognized', 'paragraph'],
		['paragraph', 'unrecognized'],
		['unrecognized', 'heading'],
		['unrecognized', 'blockquote']
	];

	for (const [a, b] of ineligible) {
		it(`${a} + ${b} are NOT mergeable`, () => {
			expect(isMergeEligible(a as BlockKind, b as BlockKind)).toBe(false);
		});
	}
});

describe('findMergeTarget', () => {
	function parseBlock(src: string): CstNode {
		const doc = parse(src);
		return doc.children[0];
	}

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
	function parseBlock(src: string): CstNode {
		const doc = parse(src);
		return doc.children[0];
	}

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
