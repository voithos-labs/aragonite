import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../../../core/parser';
import { serialize } from '../../../../core/serializer';
import { createSharingState } from '../../../../tree-operations/sharing';
import { registerCalloutForTests } from '../../chrome-plugins';
import { cellPoint, type SelectionPoint } from '../../../../selection/primitives';
import { deleteRange } from '../../../harness/range-delete';

// `involvesTable` is checked before `involvesReservedChrome`, so these ranges take the table branch
// and the title-line wall must hold there too. Table endpoints are already-snapped cell indices.

// [0]=Above, [1]=note ([1,0]=title, [1,1]=table of rows (a,b)/(1,2)), [2]=Below.
const TBL_FIXTURE =
	'Above\n\n:::callout Title\n| a | b |\n| --- | --- |\n| 1 | 2 |\n:::\n\nBelow\n';
// [0]=table, [1]=note ([1,0]=title, [1,1]=para "Body"), [2]=Below.
const TBL_ABOVE_FIXTURE =
	'| a | b |\n| --- | --- |\n| 1 | 2 |\n\n:::callout Title\nBody\n:::\n\nBelow\n';
// [0]=table, [1]=note ([1,0]=title, [1,1]=table of rows (c,d)/(3,4)), [2]=Below.
const TBL_BOTH_FIXTURE =
	'| a | b |\n| --- | --- |\n| 1 | 2 |\n\n:::callout Title\n| c | d |\n| --- | --- |\n| 3 | 4 |\n:::\n\nBelow\n';

function point(path: number[], offset: number): SelectionPoint {
	return { path, offset };
}

function run(source: string, start: SelectionPoint, end: SelectionPoint) {
	const doc = parse(source);
	const result = deleteRange(doc, start, end);
	return {
		doc: result.newDoc,
		source: serialize(result.newDoc),
		caret: result.caret(result.newDoc)
	};
}

describe('chrome wall × table branch: table endpoint inside the container', () => {
	beforeEach(registerCalloutForTests);

	it('pins the fixture parse: title + table body child', () => {
		const note = parse(TBL_FIXTURE).children[1];
		expect(note.kind).toBe('callout');
		expect(note.children?.map((c) => c.kind)).toEqual(['directiveOpenerLine', 'table']);
		expect(note.children?.[1].children).toHaveLength(2);
	});

	it('between-hole: prose above → body table cell clears the opener line it crossed', () => {
		// end.offset 1 = inclusive last cell of header row → header removed, body promoted.
		const { source, caret } = run(TBL_FIXTURE, point([0], 2), cellPoint([1, 1], 1));
		// The truncated prose head keeps its line ending, so the blank line the source had between it
		// and the container survives.
		expect(source).toBe('Ab\n\n\n| 1 | 2 |\n| --- | --- |\n:::\n\nBelow\n');
		expect(caret).toEqual({ path: [0], offset: 2 });
	});

	it('chrome-start endpoint: mid-title → body table truncates the title by raw write', () => {
		const { doc, source, caret } = run(TBL_FIXTURE, point([1, 0], 14), cellPoint([1, 1], 1));
		expect(source).toBe('Above\n\n:::callout Tit\n| 1 | 2 |\n| --- | --- |\n:::\n\nBelow\n');
		const note = doc.children[1];
		expect(note.children?.map((c) => c.kind)).toEqual(['directiveOpenerLine', 'table']);
		expect(note.children?.[0].raw).toBe(':::callout Tit\n');
		expect(caret).toEqual({ path: [1, 0], offset: 14 });
	});

	it('body table emptied but not last child: chrome clears, the rest of the body survives', () => {
		// The body is a table plus a trailing paragraph, so the emptied table is not at the end of
		// a last-child chain: no unit delete, the wall clear applies instead.
		const source = 'Above\n\n:::callout Title\n| a | b |\n| --- | --- |\n\nAfter\n:::\n\nBelow\n';
		const { source: out } = run(source, point([0], 2), cellPoint([1, 1], 1));
		expect(out).toBe('Ab\n\n\n\nAfter\n:::\n\nBelow\n');
	});

	it('G1.9: the covered chrome clears through an unshared copy, never the snapshot node', () => {
		const doc = parse(TBL_FIXTURE);
		const snapshotTitle = doc.children[1].children![0];
		const sharing = createSharingState();
		sharing.markSnapshotTaken();
		deleteRange(doc, point([0], 2), cellPoint([1, 1], 1), { sharing });
		expect(snapshotTitle.raw).toBe(':::callout Title\n');
	});
});

describe('chrome wall × table branch: table endpoint outside the container', () => {
	beforeEach(registerCalloutForTests);

	it("chrome-end endpoint: table above → mid-title keeps the opener line's tail", () => {
		// start.offset 2 = row-start of body row (1,2) → that row removed, header kept.
		const { source, caret } = run(TBL_ABOVE_FIXTURE, cellPoint([0], 2), point([1, 0], 14));
		expect(source).toBe('| a | b |\n| --- | --- |\n\nle\nBody\n:::\n\nBelow\n');
		expect(caret).toEqual({ path: [0, 0, 1], offset: 1 });
	});

	// The end truncation writes the kept tail into the title raw in place, so it must write a copy,
	// never the node the undo snapshot shares (G1.9).
	it('chrome-end truncate writes an unshared copy, never the snapshot-shared title node', () => {
		const doc = parse(TBL_ABOVE_FIXTURE);
		const snapshotTitle = doc.children[1].children![0];
		expect(snapshotTitle.raw).toBe(':::callout Title\n');

		const sharing = createSharingState();
		sharing.markSnapshotTaken();
		const { newDoc } = deleteRange(doc, cellPoint([0], 2), point([1, 0], 14), { sharing });

		expect(serialize(newDoc)).toContain('\n\nle\nBody\n');
		expect(snapshotTitle.raw).toBe(':::callout Title\n');
	});

	it('table → table across the wall: the between opener line clears via the shared collection', () => {
		const { source, caret } = run(TBL_BOTH_FIXTURE, cellPoint([0], 2), cellPoint([1, 1], 1));
		expect(source).toBe('| a | b |\n| --- | --- |\n\n\n| 3 | 4 |\n| --- | --- |\n:::\n\nBelow\n');
		expect(caret).toEqual({ path: [0, 0, 1], offset: 1 });
	});

	it('a container strictly between two outside tables still deletes whole (no stray clear)', () => {
		const source = `| a | b |\n| --- | --- |\n| 1 | 2 |\n\n:::callout Title\nBody\n:::\n\n| c | d |\n| --- | --- |\n| 3 | 4 |\n`;
		const { doc } = run(source, cellPoint([0], 2), cellPoint([2], 1));
		expect(serialize(doc)).not.toContain(':::callout');
		expect(doc.children.filter((c) => c.kind === 'table')).toHaveLength(2);
	});
});

describe('chrome wall × table branch: consumed container unit-deletes', () => {
	beforeEach(registerCalloutForTests);

	it('prose end at the container last byte: one splice, children intact', () => {
		const doc = parse(TBL_ABOVE_FIXTURE);
		const note = doc.children[1];
		const result = deleteRange(doc, cellPoint([0], 2), point([1, 1], 4));
		expect(serialize(result.newDoc)).toBe('| a | b |\n| --- | --- |\n\nBelow\n');
		// One splice, not an emptying followed by cleanup: the detached node keeps its children,
		// so the undo entry holds a whole node.
		expect(note.children?.length).toBe(2);
		expect(result.caret(result.newDoc)).toEqual({ path: [0, 0, 1], offset: 1 });
	});

	it('table end emptied as the container last child: one splice, children intact', () => {
		const doc = parse(TBL_BOTH_FIXTURE);
		const note = doc.children[1];
		// end.offset 3 = inclusive last cell of the inner table → tableEmpty.
		const result = deleteRange(doc, cellPoint([0], 2), cellPoint([1, 1], 3));
		expect(serialize(result.newDoc)).toBe('| a | b |\n| --- | --- |\n\nBelow\n');
		expect(note.children?.length).toBe(2);
		expect(result.caret(result.newDoc)).toEqual({ path: [0, 0, 1], offset: 1 });
	});

	it('start table also emptied: caret falls to the nearest survivor', () => {
		const { doc, caret } = run(TBL_ABOVE_FIXTURE, cellPoint([0], 0), point([1, 1], 4));
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph']);
		expect(doc.children[0].raw).toBe('Below\n');
		expect(caret).toEqual({ path: [0], offset: 0 });
	});
});
