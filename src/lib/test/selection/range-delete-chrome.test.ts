import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { rangeDelete } from '../../selection/range-delete';
import { involvesReservedChrome } from '../../selection/range-delete-chrome';
import { createSharingState } from '../../tree-operations/sharing';
import { __resetPasteSurfacesForTests } from '../../tree-operations/paste-surfaces';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import type { SelectionPoint } from '../../selection/primitives';

// Two body children so in-place truncation is distinguishable from an upward
// merge. Paths: [0]=Above, [1]=note ([1,0]=title, [1,1]=Body1, [1,2]=Body2),
// [2]=Below.
const FIXTURE = 'Above\n\n:::note Title\nBody1\n\nBody2\n:::\n\nBelow\n';

function point(path: number[], offset: number): SelectionPoint {
	return { path, offset };
}

function run(source: string, start: SelectionPoint, end: SelectionPoint) {
	const doc = parse(source);
	const result = rangeDelete(doc, start, end, createSharingState(), undefined);
	return { doc: result.newDoc, source: serialize(result.newDoc), caret: result.collapsedCaret };
}

function registerCallout() {
	// registerChromeLeaf (inside registerCalloutKind) registers a paste surface;
	// the schema reset alone leaves it orphaned, so a re-register would collide.
	__resetSchemaRegistriesForTests();
	__resetPasteSurfacesForTests();
	registerCalloutKind();
}

describe('involvesReservedChrome — gate tightness', () => {
	beforeEach(registerCallout);

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
	beforeEach(registerCallout);

	it('pins the fixture parse: title + two body paragraphs', () => {
		const note = parse(FIXTURE).children[1];
		expect(note.kind).toBe('note');
		expect(note.children?.map((c) => c.kind)).toEqual(['note-title', 'paragraph', 'paragraph']);
		expect(note.children?.map((c) => c.raw)).toEqual(['Title\n', 'Body1\n', 'Body2\n']);
	});

	it('end-in-chrome, full coverage: chrome clears in place, body intact, no merge', () => {
		const { doc, source, caret } = run(FIXTURE, point([0], 2), point([1, 0], 5));
		expect(source).toBe('Ab\n\n:::note\nBody1\n\nBody2\n:::\n\nBelow\n');
		expect(doc.children[1].children?.[0].kind).toBe('note-title');
		expect(caret).toEqual({ path: [0], offset: 2 });
	});

	it('end-in-chrome, partial coverage: chrome keeps its tail, never merged upward', () => {
		const { doc, source } = run(FIXTURE, point([0], 2), point([1, 0], 3));
		expect(source).toBe('Ab\n\n:::note le\nBody1\n\nBody2\n:::\n\nBelow\n');
		expect(doc.children[1].children?.[0].kind).toBe('note-title');
	});

	it('chrome between: start truncates, chrome clears, end body child keeps its tail in place', () => {
		const { doc, source } = run(FIXTURE, point([0], 2), point([1, 1], 2));
		expect(source).toBe('Ab\n\n:::note\ndy1\n\nBody2\n:::\n\nBelow\n');
		expect(doc.children[1].children?.map((c) => c.kind)).toEqual([
			'note-title',
			'paragraph',
			'paragraph'
		]);
	});

	it('start-in-chrome, end outside: title keeps its head, body deletes, container survives', () => {
		const { doc, source, caret } = run(FIXTURE, point([1, 0], 3), point([2], 3));
		expect(source).toBe('Above\n\n:::note Tit\n:::\n\now\n');
		expect(doc.children[1].children?.map((c) => c.kind)).toEqual(['note-title']);
		expect(caret).toEqual({ path: [1, 0], offset: 3 });
	});

	it('chrome start into own body: the chrome/body wall holds inside one container', () => {
		const { doc, source } = run(FIXTURE, point([1, 0], 3), point([1, 2], 3));
		expect(source).toBe('Above\n\n:::note Tit\n\ny2\n:::\n\nBelow\n');
		expect(doc.children[1].children?.map((c) => c.kind)).toEqual(['note-title', 'paragraph']);
	});

	// Equivalence pin for the shared-ceremony unification (range-delete-ceremony.ts):
	// when start sits inside the end container, resolveEndWall returns null (the
	// container is not a wall), so it is never marked consumed and never unit-
	// deleted — even here, where the end endpoint lands on the container's last
	// byte. This branch's inline predecessor computed a non-null chromeClearPath in
	// this state, but chrome child 0 is start's own path or precedes it in doc
	// order, so it never lands in the strictly-between walk and no chrome clears;
	// the container survives with its body truncated in place. A unification that
	// dropped resolveEndWall's start-inside guard would delete the whole container
	// — red-first verified against exactly that break.
	it('start in chrome, end at the container last byte: the container survives (start-inside guard)', () => {
		const { doc, source } = run(FIXTURE, point([1, 0], 3), point([1, 2], 5));
		expect(source).toBe('Above\n\n:::note Tit\n\n\n:::\n\nBelow\n');
		expect(doc.children[1].kind).toBe('note');
		expect(doc.children[1].children?.map((c) => c.kind)).toEqual(['note-title', 'paragraph']);
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
			undefined
		);
		expect(serialize(result.newDoc)).toBe('Above\n\nBelow\n');
		// One splice, not an empty-then-cascade: the detached node keeps its
		// children so a commit scope holding it stays invariant-clean.
		expect(note.children?.length).toBe(3);
	});

	// Deliberate degenerate (not a bug): when the end endpoint fully covers a
	// surviving body child, the wall truncates it in place to an empty paragraph
	// rather than node-deleting it (the generic path would delete). The wall's
	// in-place rule is what keeps the chrome/body boundary from merging; a
	// fully-covered survivor is its degenerate case, pinned here so a future
	// "tidy up the empty paragraph" change trips this test first.
	it('end fully covering a body child leaves it as an empty paragraph in place', () => {
		const { doc, source } = run(FIXTURE, point([0], 2), point([1, 1], 5));
		expect(source).toBe('Ab\n\n:::note\n\n\nBody2\n:::\n\nBelow\n');
		expect(doc.children[1].children?.map((c) => c.kind)).toEqual([
			'note-title',
			'paragraph',
			'paragraph'
		]);
		expect(doc.children[1].children?.map((c) => c.raw)).toEqual(['\n', '\n', 'Body2\n']);
	});

	// G1.9 regression guard for T4's clear-write unshare: the covered chrome must
	// clear through an unshared COPY, never the snapshot-shared node. Marking a
	// snapshot BEFORE the delete makes the parsed title count as shared; if the
	// clear loop dropped its unshare, `chrome.raw = '\n'` would corrupt the raw an
	// undo entry still references. `getSource` reads the container's authoritative
	// raw and is blind to this — assert the child node directly.
	it('clears covered chrome without corrupting the snapshot-shared title node', () => {
		const doc = parse(FIXTURE);
		const snapshotTitle = doc.children[1].children![0];
		expect(snapshotTitle.raw).toBe('Title\n');

		const sharing = createSharingState();
		sharing.markSnapshotTaken();
		rangeDelete(doc, point([0], 2), point([1, 1], 2), sharing, undefined);

		expect(snapshotTitle.raw).toBe('Title\n');
	});
});

describe('chrome wall — generic-path parity (gate stays out of the way)', () => {
	beforeEach(registerCallout);

	it('body-only range merges exactly like a blockquote', () => {
		const callout = run(FIXTURE, point([1, 1], 2), point([1, 2], 3));
		expect(callout.source).toBe('Above\n\n:::note Title\nBoy2\n:::\n\nBelow\n');

		const bq = run('Above\n\n> Body1\n>\n> Body2\n\nBelow\n', point([1, 0], 2), point([1, 1], 3));
		expect(bq.source).toBe('Above\n\n> Boy2\n\nBelow\n');
	});

	it('a range strictly around the container deletes it on the generic path', () => {
		const { source } = run(FIXTURE, point([0], 5), point([2], 3));
		expect(source).toBe('Aboveow\n');
	});
});
