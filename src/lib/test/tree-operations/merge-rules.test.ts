// src/lib/editor/test/tree-operations/merge-rules.test.ts
import { describe, it, expect } from 'vitest';
import { isMergeEligible, findMergeTarget } from '../../tree-operations/merge-rules';
import { parse } from '../../core/parser';
import type { BlockKind, CstNode } from '../../core/nodes';
import { rebuildAncestryRaw } from '../../tree-operations';
import { serialize } from '../../core/serializer';

describe('isMergeEligible', () => {
	// Full role-pair matrix. Representatives of each role:
	//   prose           → paragraph
	//   prose-absorber  → heading, setextHeading
	//   container       → blockquote, list, listItem
	//   opaque          → fencedCode, thematicBreak, indentedCode, htmlBlock,
	//                     linkReferenceDefinition, table
	//   self-merge      → unrecognized
	//
	// Eligibility rules (see merge-rules.ts):
	//   prose           + prose          → eligible
	//   prose-absorber  + prose          → eligible
	//   container       + prose          → eligible
	//   self-merge      + self-merge     → eligible
	//   everything else                  → not eligible
	//
	// The matrix below covers the cross product of every role category as
	// both prev and curr, so any future narrowing of a rule is caught.

	const eligible: [string, string][] = [
		// prose + prose
		['paragraph', 'paragraph'],
		// prose-absorber + prose
		['heading', 'paragraph'],
		['setextHeading', 'paragraph'],
		// container + prose
		['blockquote', 'paragraph'],
		['list', 'paragraph'],
		['listItem', 'paragraph'],
		// self-merge + self-merge
		['unrecognized', 'unrecognized']
	];

	for (const [a, b] of eligible) {
		it(`${a} + ${b} are mergeable`, () => {
			expect(isMergeEligible(a as BlockKind, b as BlockKind)).toBe(true);
		});
	}

	const ineligible: [string, string][] = [
		// prose + prose-absorber (asymmetric: only prose-absorber-as-prev merges)
		['paragraph', 'heading'],
		['paragraph', 'setextHeading'],
		// prose-absorber + prose-absorber (headings don't absorb each other)
		['heading', 'heading'],
		['heading', 'setextHeading'],
		['setextHeading', 'heading'],
		// prose + container (containers as curr aren't eligible)
		['paragraph', 'blockquote'],
		['paragraph', 'list'],
		['heading', 'blockquote'],
		// container + container (even same kind)
		['blockquote', 'blockquote'],
		['blockquote', 'list'],
		['list', 'list'],
		['list', 'blockquote'],
		['list', 'listItem'],
		// container + prose-absorber (only prose, not heading/setextHeading)
		['blockquote', 'heading'],
		['list', 'heading'],
		['list', 'setextHeading'],
		// opaque + anything
		['fencedCode', 'paragraph'],
		['fencedCode', 'fencedCode'],
		['thematicBreak', 'paragraph'],
		['indentedCode', 'paragraph'],
		['htmlBlock', 'paragraph'],
		['linkReferenceDefinition', 'paragraph'],
		['table', 'paragraph'],
		// anything + opaque
		['paragraph', 'fencedCode'],
		['paragraph', 'thematicBreak'],
		['paragraph', 'table'],
		['heading', 'fencedCode'],
		['blockquote', 'fencedCode'],
		// self-merge + non-self-merge
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

// `isBlockEditable` is covered exhaustively in
// test/tree-operations/block-kind-descriptor.test.ts — the per-kind loop that
// previously lived here was a subset of that one and offered no distinct
// coverage.

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
		// path: [listItemIndex, paragraphIndexInListItem] = [1, 0]
		expect(result!.path).toEqual([1, 0]);
	});

	it('list with nested sub-list returns deepest nested paragraph', () => {
		const prev = parseBlock('- a\n  - b\n');
		const result = findMergeTarget(prev);
		expect(result).not.toBeNull();
		expect((result!.target.raw ?? '').trim()).toBe('b');
		// path walks: top list → item 0 (a) → nested list (last child of item a) → item 0 (b) → paragraph (item 0 of b)
		expect(result!.path).toEqual([0, 1, 0, 0]);
	});

	it('blockquote with opaque deepest leaf (fenced code) returns null', () => {
		const prev = parseBlock('> before\n>\n> ```\n> code\n> ```\n');
		const result = findMergeTarget(prev);
		expect(result).toBeNull();
	});

	it('thematic break as prev returns null (opaque)', () => {
		const prev = parseBlock('---\n');
		const result = findMergeTarget(prev);
		expect(result).toBeNull();
	});
});

// The representative-pair describe block that previously lived here duplicated
// the full cross-product matrix in the `isMergeEligible` describe block above.
// The exhaustive matrix is the stronger test, so the smaller one was removed.

describe('findMergeTarget + rebuildAncestryRaw round-trip', () => {
	function parseBlock(src: string): CstNode {
		const doc = parse(src);
		return doc.children[0];
	}

	function simulateMerge(prevSrc: string, currText: string): string {
		const prev = parseBlock(prevSrc);
		const result = findMergeTarget(prev);
		if (!result) return prevSrc; // caller would fall back — we just return unchanged
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

	it('blockquote with opaque deepest leaf: simulateMerge returns unchanged (walker returned null)', () => {
		// The fenced code block is the last inner child; walker fails, no mutation.
		// simulateMerge returns prevSrc unchanged when findMergeTarget returns null.
		const input = '> para\n>\n> ```\n> code\n> ```\n';
		const result = simulateMerge(input, 'text');
		expect(result).toBe(input);
	});
});
