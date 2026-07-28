import { describe, it, expect } from 'vitest';
import { rangeDelete } from '../../selection/range-delete';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { createSharingState } from '../../tree-operations/sharing';

function run(
	source: string,
	start: { path: number[]; offset: number },
	end: { path: number[]; offset: number }
) {
	const doc = parse(source);
	const result = rangeDelete(doc, start, end, createSharingState(), undefined);
	return { source: serialize(result.newDoc), caret: result.collapsedCaret };
}

describe('rangeDelete — same-container cases', () => {
	it('deletes a range within a single paragraph', () => {
		const { source, caret } = run('abcdef\n', { path: [0], offset: 1 }, { path: [0], offset: 4 });
		expect(source).toBe('aef\n');
		expect(caret).toEqual({ path: [0], offset: 1 });
	});

	it('merges two adjacent top-level paragraphs at an interior offset', () => {
		const { source, caret } = run(
			'hello world\n\nfoo bar\n',
			{ path: [0], offset: 6 },
			{ path: [1], offset: 4 }
		);
		expect(source).toBe('hello bar\n');
		expect(caret).toEqual({ path: [0], offset: 6 });
	});

	it('deletes middle blocks between two top-level endpoints', () => {
		const { source } = run(
			'aaa\n\nbbb\n\nccc\n\nddd\n',
			{ path: [0], offset: 2 },
			{ path: [3], offset: 1 }
		);
		expect(source).toBe('aadd\n');
	});
});

describe('rangeDelete — cross-container start-wins', () => {
	it('start outside container, end inside blockquote: merges at top level, blockquote cleans up', () => {
		const { source, caret } = run(
			'before paragraph\n\n> quote line 1\n> quote line 2\n',
			{ path: [0], offset: 7 },
			{ path: [1, 0], offset: 19 }
		);
		expect(source).toBe('before line 2\n');
		expect(caret).toEqual({ path: [0], offset: 7 });
	});

	it("start inside blockquote, end outside: merges at start's position, blockquote survives", () => {
		const { source, caret } = run(
			'> inside quote line 1\n> inside quote line 2\n\nafter paragraph\n',
			{ path: [0, 0], offset: 7 },
			{ path: [1], offset: 6 }
		);
		expect(source).toBe('> inside paragraph\n');
		expect(caret).toEqual({ path: [0, 0], offset: 7 });
	});

	it("sibling-container collapse: two blockquotes merge into start's blockquote", () => {
		const { source } = run(
			'> first bq\n\nmiddle\n\n> second bq\n',
			{ path: [0, 0], offset: 6 },
			{ path: [2, 0], offset: 7 }
		);
		expect(source).toBe('> first bq\n');
	});
});

describe('rangeDelete — end-container post-end siblings preservation', () => {
	it('end inside first item of unordered list preserves later items', () => {
		const src =
			'## Unordered Lists\n\n- Unordered one\n- Unordered two\n  - Nested item\n- Unordered three\n';
		const { source } = run(src, { path: [0], offset: 13 }, { path: [1, 0, 0], offset: 10 });
		expect(source).toBe(
			'## Unordered one\n\n- Unordered two\n  - Nested item\n- Unordered three\n'
		);
	});

	it('end inside first item of ordered list preserves later items', () => {
		const src = '## H\n\n1. one\n2. two\n3. three\n';
		const { source } = run(src, { path: [0], offset: 4 }, { path: [1, 0, 0], offset: 4 });
		expect(source).toBe('## H\n2. two\n3. three\n');
	});

	it('end inside first paragraph of multi-paragraph blockquote preserves later paragraphs', () => {
		const src = 'before\n\n> first para\n>\n> second para\n>\n> third para\n';
		const { source } = run(src, { path: [0], offset: 4 }, { path: [1, 0], offset: 5 });
		expect(source).toBe('befo para\n\n>\n> second para\n>\n> third para\n');
	});

	it('end inside multi-paragraph list item preserves later paragraphs in same item', () => {
		const src = 'pre\n\n- first para\n\n  second para\n\n- another item\n';
		const { source } = run(src, { path: [0], offset: 0 }, { path: [1, 0, 0], offset: 5 });
		expect(source).toContain('second para');
		expect(source).toContain('another item');
	});

	it('mid-container end keeps its later siblings inside the same container', () => {
		const src = '## H\n\n- one\n- two\n- three\n';
		const { source } = run(src, { path: [0], offset: 4 }, { path: [1, 1, 0], offset: 2 });
		expect(source).toContain('o\n');
		expect(source).toContain('three');
	});
});

describe('rangeDelete — boundary offsets', () => {
	it('start.offset = 0 keeps empty head, re-parses as paragraph from endTail', () => {
		const { source } = run(
			'# heading text\n\nfollow paragraph\n',
			{ path: [0], offset: 0 },
			{ path: [1], offset: 7 }
		);
		expect(source).toBe('paragraph\n');
	});

	it('end.offset at end of endBlock yields startHead only', () => {
		const { source } = run('keep\n\ndelete\n', { path: [0], offset: 4 }, { path: [1], offset: 6 });
		expect(source).toBe('keep\n');
	});
});

describe('rangeDelete — cascade identity discipline (Tier 2 G2)', () => {
	// Cascade and delete share one identity check: an iteration whose path
	// resolves to a different node (a survivor slid into the slot via a deeper
	// cascade) must skip both the splice AND the ancestor walk. Asymmetry was
	// the original bug (cascade ran on stale paths). These fixtures exercise
	// slide-in shapes; they pin the post-delete tree so any future loop change
	// that re-introduces stale-path cascade shows up here.

	it('post-end top-level survivor that slides into a vacated outer slot is preserved', () => {
		// After the delete chain: [1, 0, 0]=A → cascade removes inner_bq [1, 0]
		// and outer_bq [1]. doc.children becomes [start, post-end], so the
		// outer_bq slot path [1] now resolves to the post-end paragraph. The
		// identity check fires here. Cascade must not walk that survivor's
		// ancestry.
		const src = 'start\n\n> > A\n\nend\n\npost-end\n';
		const { source } = run(src, { path: [0], offset: 5 }, { path: [2], offset: 3 });
		expect(source).toBe('start\n\npost-end\n');
	});

	it('post-end nested survivor that slides through cascade levels is preserved', () => {
		// outer_bq holds two inner blockquotes. The first wraps the deletion
		// target A; the second is post-end and survives. After A's delete +
		// cascade, the second inner blockquote slides into [1, 0]'s slot.
		const src = 'start\n\n> > A\n>\n> > B\n';
		// end at end of "A\n" line: path [1, 0, 0], offset = displayLength("A\n")
		// = 2. Then walkBetween adds [1, 0, 0] as end.path only (the inner_bq
		// and outer_bq are ancestors of end and excluded by isPathSubtreeBetween).
		const { source } = run(src, { path: [0], offset: 5 }, { path: [1, 0, 0], offset: 2 });
		// "A\n" is fully consumed (start.offset=5 trims newline of "start",
		// end.offset=2 trims everything from inner_bq's leaf). Survivor inner_bq
		// containing B must remain.
		expect(source).toContain('B');
		expect(source).toMatch(/^start/);
	});

	it('deeply-nested chain cleanup leaves doc-root tail blocks intact', () => {
		// Multiple top-level blocks after end. After the merge + cascade chain,
		// each post-end block has shifted index, and a stale ancestor path
		// could (pre-fix) walk into them. Assert all post-end blocks survive.
		const src = 'start\n\n> > > deep\n\nend\n\ntail1\n\ntail2\n';
		const { source } = run(src, { path: [0], offset: 5 }, { path: [2], offset: 3 });
		expect(source).toBe('start\n\ntail1\n\ntail2\n');
	});
});
