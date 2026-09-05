import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { rangeDelete } from '../../selection/range-delete';
import { involvesReservedChrome } from '../../selection/range-delete-chrome';
import { createSharingState } from '../../tree-operations/sharing';
import { registerCalloutForTests } from './chrome-plugins';
import { expectParseConverged } from '../harness/parse-converged';
import type { SelectionPoint } from '../../selection/primitives';

// Two body children so in-place truncation is distinguishable from an upward merge. Paths:
// [0]=Above, [1]=note ([1,0]=title, [1,1]=Body1, [1,2]=Body2), [2]=Below.
const FIXTURE = 'Above\n\n:::callout Title\nBody1\n\nBody2\n:::\n\nBelow\n';

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

describe('involvesReservedChrome — gate tightness', () => {
	beforeEach(registerCalloutForTests);

	const cases: Array<[string, SelectionPoint, SelectionPoint, boolean]> = [
		['end in chrome', point([0], 2), point([1, 0], 5), true],
		['start in chrome, end outside', point([1, 0], 3), point([2], 3), true],
		['chrome start into own body', point([1, 0], 3), point([1, 1], 2), true],
		['start in body, end outside', point([1, 1], 2), point([2], 3), true],
		['range ending at the container last byte', point([0], 5), point([1, 2], 5), true],
		['body-only range inside the container', point([1, 1], 2), point([1, 2], 3), false],
		['same-block range inside the chrome', point([1, 0], 1), point([1, 0], 4), false],
		['range strictly around the container', point([0], 5), point([2], 3), false]
	];

	for (const [name, start, end, expected] of cases) {
		it(`${name} → ${expected}`, () => {
			expect(involvesReservedChrome(parse(FIXTURE), start, end)).toBe(expected);
		});
	}

	it('never fires for undeclared containers (blockquote)', () => {
		const doc = parse('Above\n\n> one\n>\n> two\n\nBelow\n');
		expect(involvesReservedChrome(doc, point([0], 2), point([1, 0], 2))).toBe(false);
	});
});

describe('chrome wall — rangeDelete post-states', () => {
	beforeEach(registerCalloutForTests);

	it('pins the fixture parse: title + two body paragraphs', () => {
		const note = parse(FIXTURE).children[1];
		expect(note.kind).toBe('callout');
		expect(note.children?.map((c) => c.kind)).toEqual(['callout-title', 'paragraph', 'paragraph']);
		expect(note.children?.map((c) => c.raw)).toEqual(['Title\n', 'Body1\n', 'Body2\n']);
	});

	it('end-in-chrome, full coverage: chrome clears in place, body intact, no merge', () => {
		const { doc, source, caret } = run(FIXTURE, point([0], 2), point([1, 0], 5));
		expect(source).toBe('Ab\n\n:::callout\nBody1\n\nBody2\n:::\n\nBelow\n');
		expect(doc.children[1].children?.[0].kind).toBe('callout-title');
		expect(caret).toEqual({ path: [0], offset: 2 });
	});

	it('end-in-chrome, partial coverage: chrome keeps its tail, never merged upward', () => {
		const { doc, source } = run(FIXTURE, point([0], 2), point([1, 0], 3));
		expect(source).toBe('Ab\n\n:::callout le\nBody1\n\nBody2\n:::\n\nBelow\n');
		expect(doc.children[1].children?.[0].kind).toBe('callout-title');
	});

	it('chrome between: start truncates, chrome clears, end body child keeps its tail in place', () => {
		const { doc, source } = run(FIXTURE, point([0], 2), point([1, 1], 2));
		expect(source).toBe('Ab\n\n:::callout\ndy1\n\nBody2\n:::\n\nBelow\n');
		expect(doc.children[1].children?.map((c) => c.kind)).toEqual([
			'callout-title',
			'paragraph',
			'paragraph'
		]);
	});

	it('start-in-chrome, end outside: title keeps its head, body deletes, container survives', () => {
		const { doc, source, caret } = run(FIXTURE, point([1, 0], 3), point([2], 3));
		expect(source).toBe('Above\n\n:::callout Tit\n:::\n\now\n');
		expect(doc.children[1].children?.map((c) => c.kind)).toEqual(['callout-title']);
		expect(caret).toEqual({ path: [1, 0], offset: 3 });
	});

	it('chrome start into own body: the chrome/body wall holds inside one container', () => {
		const { doc, source } = run(FIXTURE, point([1, 0], 3), point([1, 2], 3));
		expect(source).toBe('Above\n\n:::callout Tit\n\ny2\n:::\n\nBelow\n');
		expect(doc.children[1].children?.map((c) => c.kind)).toEqual(['callout-title', 'paragraph']);
	});

	// Equivalence pin (range-delete-ceremony.ts): with start inside the end container resolveEndWall
	// returns null, so nothing is consumed — dropping that start-inside guard deletes the container.
	it('start in chrome, end at the container last byte: the container survives (start-inside guard)', () => {
		const { doc, source } = run(FIXTURE, point([1, 0], 3), point([1, 2], 5));
		expect(source).toBe('Above\n\n:::callout Tit\n\n\n:::\n\nBelow\n');
		expect(doc.children[1].kind).toBe('callout');
		expect(doc.children[1].children?.map((c) => c.kind)).toEqual(['callout-title', 'paragraph']);
		expect(doc.children[1].children?.[0].raw).toBe('Tit\n');
	});

	it("end at the container's last byte: the container dies as one unit, children intact", () => {
		const doc = parse(FIXTURE);
		const note = doc.children[1];
		const result = rangeDelete(
			doc,
			point([0], 5),
			point([1, 2], 5),
			createSharingState(),
			undefined,
			undefined,
			undefined
		);
		expect(serialize(result.newDoc)).toBe('Above\n\nBelow\n');
		// One splice, not an empty-then-cascade: the detached node keeps its
		// children so a commit scope holding it stays invariant-clean.
		expect(note.children?.length).toBe(3);
	});

	// Deliberate degenerate (not a bug): an end fully covering a surviving body child truncates it
	// in place to an empty paragraph, because the wall's in-place rule guards the chrome/body edge.
	it('end fully covering a body child leaves it as an empty paragraph in place', () => {
		const { doc, source } = run(FIXTURE, point([0], 2), point([1, 1], 5));
		expect(source).toBe('Ab\n\n:::callout\n\n\nBody2\n:::\n\nBelow\n');
		expect(doc.children[1].children?.map((c) => c.kind)).toEqual([
			'callout-title',
			'paragraph',
			'paragraph'
		]);
		expect(doc.children[1].children?.map((c) => c.raw)).toEqual(['\n', '\n', 'Body2\n']);
		// The placeholder survives the reload only because a second blank line stands below it:
		// the `:::` peel eats the first one, and the follower's separator is that second line.
		expect(doc.children[1].children?.map((c) => c.leadingTrivia)).toEqual(['', '', '\n']);
		expectParseConverged(doc);
	});

	// G1.9 guard for the clear-write unshare: covered chrome must clear through an unshared COPY, or
	// `chrome.raw = '\n'` corrupts the raw an undo entry still references — assert the child node.
	it('clears covered chrome without corrupting the snapshot-shared title node', () => {
		const doc = parse(FIXTURE);
		const snapshotTitle = doc.children[1].children![0];
		expect(snapshotTitle.raw).toBe('Title\n');

		const sharing = createSharingState();
		sharing.markSnapshotTaken();
		rangeDelete(doc, point([0], 2), point([1, 1], 2), sharing, undefined, undefined, undefined);

		expect(snapshotTitle.raw).toBe('Title\n');
	});
});

describe('chrome wall — generic-path parity (gate stays out of the way)', () => {
	beforeEach(registerCalloutForTests);

	it('body-only range merges exactly like a blockquote', () => {
		const callout = run(FIXTURE, point([1, 1], 2), point([1, 2], 3));
		expect(callout.source).toBe('Above\n\n:::callout Title\nBoy2\n:::\n\nBelow\n');

		const bq = run('Above\n\n> Body1\n>\n> Body2\n\nBelow\n', point([1, 0], 2), point([1, 1], 3));
		expect(bq.source).toBe('Above\n\n> Boy2\n\nBelow\n');
	});

	it('a range strictly around the container deletes it on the generic path', () => {
		const { source } = run(FIXTURE, point([0], 5), point([2], 3));
		expect(source).toBe('Aboveow\n');
	});
});
