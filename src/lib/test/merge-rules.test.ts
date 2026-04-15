// src/lib/editor/test/merge-rules.test.ts
import { describe, it, expect } from 'vitest';
import { isMergeEligible, isBlockEditable, findMergeTarget } from '../merge-rules';
import { parse } from '../core/parser';
import type { BlockKind, CstNode } from '../core/nodes';
import { rebuildAncestryRaw } from '../tree-operations';
import { serializeMutable } from '../mutable-tree';

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

describe('isBlockEditable', () => {
	const editable = ['paragraph', 'heading', 'fencedCode', 'blockquote', 'list', 'listItem'];

	for (const kind of editable) {
		it(`${kind} is editable`, () => {
			expect(isBlockEditable(kind as BlockKind)).toBe(true);
		});
	}

	it('thematicBreak is NOT editable', () => {
		expect(isBlockEditable('thematicBreak')).toBe(false);
	});
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

describe('isMergeEligible — role-pair coverage', () => {
	// Two representative kinds per role, exercising the cross-role boundaries
	// without the full N² combinatorial expansion.
	const PROSE = 'paragraph' as const;
	const PROSE_ABSORBER = 'heading' as const;
	const CONTAINER = 'blockquote' as const;
	const SELF_MERGE = 'unrecognized' as const;
	const OPAQUE = 'fencedCode' as const;

	it('prose + prose → eligible', () => {
		expect(isMergeEligible(PROSE, PROSE)).toBe(true);
	});

	it('prose-absorber + prose → eligible', () => {
		expect(isMergeEligible(PROSE_ABSORBER, PROSE)).toBe(true);
	});

	it('container + prose → eligible (cross-container merge)', () => {
		expect(isMergeEligible(CONTAINER, PROSE)).toBe(true);
	});

	it('self-merge + self-merge → eligible', () => {
		expect(isMergeEligible(SELF_MERGE, SELF_MERGE)).toBe(true);
	});

	it('prose + prose-absorber → not eligible (headings are not absorbed into paragraphs)', () => {
		expect(isMergeEligible(PROSE, PROSE_ABSORBER)).toBe(false);
	});

	it('prose + container → not eligible (paragraph into container as curr is out of scope)', () => {
		expect(isMergeEligible(PROSE, CONTAINER)).toBe(false);
	});

	it('container + container → not eligible', () => {
		expect(isMergeEligible(CONTAINER, CONTAINER)).toBe(false);
	});

	it('container + prose-absorber → not eligible (heading-into-blockquote out of scope)', () => {
		expect(isMergeEligible(CONTAINER, PROSE_ABSORBER)).toBe(false);
	});

	it('opaque + prose → not eligible', () => {
		expect(isMergeEligible(OPAQUE, PROSE)).toBe(false);
	});

	it('prose + opaque → not eligible', () => {
		expect(isMergeEligible(PROSE, OPAQUE)).toBe(false);
	});

	it('self-merge + prose → not eligible (mixing roles)', () => {
		expect(isMergeEligible(SELF_MERGE, PROSE)).toBe(false);
	});

	it('prose + self-merge → not eligible (mixing roles)', () => {
		expect(isMergeEligible(PROSE, SELF_MERGE)).toBe(false);
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
		if (!result) return prevSrc; // caller would fall back — we just return unchanged
		const target = result.target;
		const raw = target.raw ?? '';
		const lineEnding = raw.endsWith('\r\n') ? '\r\n' : '\n';
		const targetText = raw.replace(/\r?\n$/, '');
		target.raw = targetText + currText + lineEnding;
		if (result.path.length > 0) {
			rebuildAncestryRaw(prev, result.path);
		}
		return serializeMutable({ children: [prev], prefix: '', suffix: '' });
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
