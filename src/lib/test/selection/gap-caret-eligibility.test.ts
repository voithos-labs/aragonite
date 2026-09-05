import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { gapEligibleAt } from '../../selection/gap-caret';
import { makeBlockNode, type Document } from '../../core/nodes';

const TABLE = '| a | b |\n| - | - |\n';
const FENCE = '```\ncode\n```\n';

// paragraph, table, fencedCode, paragraph
const MIXED = parse(`para\n\n${TABLE}\n${FENCE}\npara\n`);
// table, thematicBreak
const TABLE_BREAK = parse(`${TABLE}\n---\n`);
// thematicBreak, table
const BREAK_TABLE = parse(`---\n\n${TABLE}`);
// blockquote[paragraph, fencedCode]
const QUOTE_TRAILING_FENCE = parse('> text\n>\n> ```\n> a\n> ```\n');
// blockquote[fencedCode, fencedCode]
const QUOTE_TWO_FENCES = parse('> ```\n> a\n> ```\n>\n> ```\n> b\n> ```\n');

const kinds = (doc: Document, path: number[]) => {
	let children = doc.children;
	for (const i of path) children = children[i].children ?? [];
	return children.map((c) => c.kind);
};

describe('gapEligibleAt — sibling boundaries', () => {
	it('pins the fixture shapes the truth table reads', () => {
		expect(kinds(MIXED, [])).toEqual(['paragraph', 'table', 'fencedCode', 'paragraph']);
		expect(kinds(TABLE_BREAK, [])).toEqual(['table', 'thematicBreak']);
		expect(kinds(QUOTE_TWO_FENCES, [0])).toEqual(['fencedCode', 'fencedCode']);
	});

	it('is eligible between two kinds declaring the facing edges', () => {
		expect(gapEligibleAt(MIXED, [], 2)).toBe(true);
	});

	it('declines when the preceding sibling is undeclared', () => {
		expect(gapEligibleAt(MIXED, [], 1)).toBe(false);
	});

	it('declines when the following sibling is undeclared', () => {
		expect(gapEligibleAt(MIXED, [], 3)).toBe(false);
	});

	// thematicBreak declares 'before' only — its focused Enter already inserts below.
	it('reads each side against its own edge', () => {
		expect(gapEligibleAt(TABLE_BREAK, [], 1)).toBe(true);
		expect(gapEligibleAt(BREAK_TABLE, [], 1)).toBe(false);
	});
});

describe('gapEligibleAt — scope boundaries', () => {
	it('is eligible at the start of the document when the first block declares before', () => {
		expect(gapEligibleAt(TABLE_BREAK, [], 0)).toBe(true);
		expect(gapEligibleAt(MIXED, [], 0)).toBe(false);
	});

	// The move-past-end append already owns the root's trailing boundary.
	it('declines at the end of the document', () => {
		expect(gapEligibleAt(BREAK_TABLE, [], 2)).toBe(false);
	});

	it('is eligible at the end of a non-root scope', () => {
		expect(gapEligibleAt(QUOTE_TRAILING_FENCE, [0], 2)).toBe(true);
	});

	it('declines at the start of a non-root scope whose first child is undeclared', () => {
		expect(gapEligibleAt(QUOTE_TRAILING_FENCE, [0], 0)).toBe(false);
	});

	it('resolves eligible pairs at any depth, not only the root', () => {
		expect(gapEligibleAt(QUOTE_TWO_FENCES, [0], 1)).toBe(true);
	});
});

describe('gapEligibleAt — unresolvable positions', () => {
	it.each([
		['unresolvable parent', [9], 0],
		['unresolvable deep parent', [0, 9, 9], 0],
		['negative index', [], -1],
		['index past the end', [], 99],
		['leaf parent', [0], 0]
	])('declines on %s without throwing', (_label, parentPath, index) => {
		expect(gapEligibleAt(MIXED, parentPath, index)).toBe(false);
	});

	it('declines inside a container whose children are undeclared kinds', () => {
		expect(gapEligibleAt(MIXED, [1], 1)).toBe(false);
	});

	// Only a plugin leaf can reach this shape, so the fixture is hand-built: the descriptor's
	// `isContainer`, not the presence of a children array, is what decides.
	it('declines when the parent is a leaf kind that happens to carry children', () => {
		const [paragraph, table, fence] = MIXED.children;
		const leafParent: Document = {
			...MIXED,
			children: [makeBlockNode({ ...paragraph, children: [table, fence] })]
		};
		expect(gapEligibleAt(leafParent, [0], 1)).toBe(false);
	});
});
