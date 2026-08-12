import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { rangeDelete } from '../../selection/range-delete';
import { createSharingState } from '../../tree-operations/sharing';
import { __resetPasteSurfacesForTests } from '../../tree-operations/paste-surfaces';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import type { SelectionPoint } from '../../selection/primitives';
import { allowDevWarns } from '$lib/test/support/warn-gate';

// rangeDelete is driven with hand-built endpoints, so the table arms see char offsets
// SelectionState would have snapped to cell coordinates first.
afterEach(() =>
	allowDevWarns([
		'deleteFromProseIntoTable:end',
		'deleteFromTableIntoProse:start',
		'deleteAcrossTwoTables:start',
		'deleteAcrossTwoTables:end'
	])
);

// The chrome wall × the table branch: `involvesTable` dispatches before `involvesReservedChrome`,
// so these ranges ride the table branch and the wall must hold there too. Table endpoints carry
// already-snapped cell indices (start = row start, end = inclusive row-last cell).

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
	const result = rangeDelete(
		doc,
		start,
		end,
		createSharingState(),
		undefined,
		undefined,
		undefined
	);
	return { doc: result.newDoc, source: serialize(result.newDoc), caret: result.collapsedCaret };
}

function registerCallout() {
	// registerChromeLeaf (inside registerCalloutKind) registers a paste surface;
	// the schema reset alone leaves it orphaned, so a re-register would collide.
	__resetSchemaRegistriesForTests();
	__resetPasteSurfacesForTests();
	registerCalloutKind();
}

describe('chrome wall × table branch — table endpoint inside the container', () => {
	beforeEach(registerCallout);

	it('pins the fixture parse: title + table body child', () => {
		const note = parse(TBL_FIXTURE).children[1];
		expect(note.kind).toBe('callout');
		expect(note.children?.map((c) => c.kind)).toEqual(['callout-title', 'table']);
		expect(note.children?.[1].children).toHaveLength(2);
	});

	it('between-hole: prose above → body table cell clears the chrome in place', () => {
		// end.offset 1 = inclusive last cell of header row → header removed, body promoted.
		const { doc, source, caret } = run(TBL_FIXTURE, point([0], 2), point([1, 1], 1));
		// The truncated prose head keeps its line ending, so the blank line the source had between it
		// and the container survives — matching the chrome-start case below.
		expect(source).toBe('Ab\n\n:::callout\n| 1 | 2 |\n| --- | --- |\n:::\n\nBelow\n');
		const note = doc.children[1];
		expect(note.children?.map((c) => c.kind)).toEqual(['callout-title', 'table']);
		expect(note.children?.[0].raw).toBe('\n');
		expect(caret).toEqual({ path: [0], offset: 2 });
	});

	it('chrome-start endpoint: mid-title → body table truncates the title by raw write', () => {
		const { doc, source, caret } = run(TBL_FIXTURE, point([1, 0], 3), point([1, 1], 1));
		expect(source).toBe('Above\n\n:::callout Tit\n| 1 | 2 |\n| --- | --- |\n:::\n\nBelow\n');
		const note = doc.children[1];
		expect(note.children?.map((c) => c.kind)).toEqual(['callout-title', 'table']);
		expect(note.children?.[0].raw).toBe('Tit\n');
		expect(caret).toEqual({ path: [1, 0], offset: 3 });
	});

	it('body table emptied but not last child: chrome clears, the rest of the body survives', () => {
		// Body = table + trailing paragraph, so the emptied table is NOT a
		// last-child chain — no unit delete, the wall clear applies instead.
		const source = 'Above\n\n:::callout Title\n| a | b |\n| --- | --- |\n\nAfter\n:::\n\nBelow\n';
		const { doc, source: out } = run(source, point([0], 2), point([1, 1], 1));
		expect(out).toBe('Ab\n\n:::callout\n\nAfter\n:::\n\nBelow\n');
		expect(doc.children[1].children?.map((c) => c.kind)).toEqual(['callout-title', 'paragraph']);
	});

	it('G1.9: the covered chrome clears through an unshared copy, never the snapshot node', () => {
		const doc = parse(TBL_FIXTURE);
		const snapshotTitle = doc.children[1].children![0];
		const sharing = createSharingState();
		sharing.markSnapshotTaken();
		rangeDelete(doc, point([0], 2), point([1, 1], 1), sharing, undefined, undefined, undefined);
		expect(snapshotTitle.raw).toBe('Title\n');
	});
});

describe('chrome wall × table branch — table endpoint outside the container', () => {
	beforeEach(registerCallout);

	it('chrome-end endpoint: table above → mid-title keeps the tail in the chrome leaf', () => {
		// start.offset 2 = row-start of body row (1,2) → that row removed, header kept.
		const { doc, source, caret } = run(TBL_ABOVE_FIXTURE, point([0], 2), point([1, 0], 3));
		expect(source).toBe('| a | b |\n| --- | --- |\n\n:::callout le\nBody\n:::\n\nBelow\n');
		const note = doc.children[1];
		expect(note.children?.map((c) => c.kind)).toEqual(['callout-title', 'paragraph']);
		expect(note.children?.[0].raw).toBe('le\n');
		expect(caret).toEqual({ path: [0, 0, 1], offset: 1 });
	});

	// G1.9 guard for the chrome-END truncate: the kept tail is written into the title raw in place,
	// so a narrowed branch-entry unshare writes through a snapshot-shared node — assert the child.
	it('chrome-end truncate writes an unshared copy, never the snapshot-shared title node', () => {
		const doc = parse(TBL_ABOVE_FIXTURE);
		const snapshotTitle = doc.children[1].children![0];
		expect(snapshotTitle.raw).toBe('Title\n');

		const sharing = createSharingState();
		sharing.markSnapshotTaken();
		const { newDoc } = rangeDelete(
			doc,
			point([0], 2),
			point([1, 0], 3),
			sharing,
			undefined,
			undefined,
			undefined
		);

		expect(newDoc.children[1].children![0].raw).toBe('le\n');
		expect(snapshotTitle.raw).toBe('Title\n');
	});

	it('table → table across the wall: the between chrome clears via the shared collection', () => {
		const { doc, source, caret } = run(TBL_BOTH_FIXTURE, point([0], 2), point([1, 1], 1));
		expect(source).toBe(
			'| a | b |\n| --- | --- |\n\n:::callout\n| 3 | 4 |\n| --- | --- |\n:::\n\nBelow\n'
		);
		const note = doc.children[1];
		expect(note.children?.map((c) => c.kind)).toEqual(['callout-title', 'table']);
		expect(note.children?.[0].raw).toBe('\n');
		expect(caret).toEqual({ path: [0, 0, 1], offset: 1 });
	});

	it('a container strictly between two outside tables still deletes whole (no stray clear)', () => {
		const source = `| a | b |\n| --- | --- |\n| 1 | 2 |\n\n:::callout Title\nBody\n:::\n\n| c | d |\n| --- | --- |\n| 3 | 4 |\n`;
		const { doc } = run(source, point([0], 2), point([2], 1));
		expect(serialize(doc)).not.toContain(':::callout');
		expect(doc.children.filter((c) => c.kind === 'table')).toHaveLength(2);
	});
});

describe('chrome wall × table branch — consumed container unit-deletes', () => {
	beforeEach(registerCallout);

	it('prose end at the container last byte: one splice, children intact', () => {
		const doc = parse(TBL_ABOVE_FIXTURE);
		const note = doc.children[1];
		const result = rangeDelete(
			doc,
			point([0], 2),
			point([1, 1], 4),
			createSharingState(),
			undefined,
			undefined,
			undefined
		);
		expect(serialize(result.newDoc)).toBe('| a | b |\n| --- | --- |\n\nBelow\n');
		// One splice, not an empty-then-cascade: the detached node keeps its
		// children so a commit scope holding it stays invariant-clean.
		expect(note.children?.length).toBe(2);
		expect(result.collapsedCaret).toEqual({ path: [0, 0, 1], offset: 1 });
	});

	it('table end emptied as the container last child: one splice, children intact', () => {
		const doc = parse(TBL_BOTH_FIXTURE);
		const note = doc.children[1];
		// end.offset 3 = inclusive last cell of the inner table → tableEmpty.
		const result = rangeDelete(
			doc,
			point([0], 2),
			point([1, 1], 3),
			createSharingState(),
			undefined,
			undefined,
			undefined
		);
		expect(serialize(result.newDoc)).toBe('| a | b |\n| --- | --- |\n\nBelow\n');
		expect(note.children?.length).toBe(2);
		expect(result.collapsedCaret).toEqual({ path: [0, 0, 1], offset: 1 });
	});

	it('start table also emptied: caret falls to the nearest survivor', () => {
		const { doc, caret } = run(TBL_ABOVE_FIXTURE, point([0], 0), point([1, 1], 4));
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph']);
		expect(doc.children[0].raw).toBe('Below\n');
		expect(caret).toEqual({ path: [0], offset: 0 });
	});
});
