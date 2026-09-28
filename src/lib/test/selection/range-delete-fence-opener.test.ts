import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { rangeDelete } from '$lib/selection/range-delete';
import { coverRange } from '$lib/selection/range-coverage';
import { createSharingState } from '$lib/tree-operations/sharing';
import { registerCalloutForTests } from './chrome-plugins';
import { expectParseConverged } from '../harness/parse-converged';
import { allowDevWarns } from '$lib/test/support/warn-gate';
import { fixtureReading } from '../harness/fixture-grammar';

// rangeDelete is driven with hand-built endpoints, so the table branch sees a character offset
// `SelectionState` would have snapped to a cell coordinate.
afterEach(() => allowDevWarns(['deleteFromTableIntoProse:start']));

// A range ending in a code body takes the opener, and the surviving closer would reopen a fence.
// Miss-analysis: GH #58; the fence pins only drove ranges that start in a code body.

const sharing = () => createSharingState();

const kindsOf = (doc: ReturnType<typeof parse>) => doc.children.map((c) => c.kind);

describe('range delete that consumes a fenced code opener', () => {
	it('drops the closer the cross-block merge stranded', () => {
		const doc = parse('para\n\n```js\nbody\n```\n\ntail\n');

		const { collapsedCaret } = rangeDelete(
			doc,
			coverRange(doc, { path: [0], offset: 2 }, { path: [1], offset: 8 }),
			sharing(),
			fixtureReading(),
			'keyless'
		);

		expect(serialize(doc)).toBe('pady\n\ntail\n');
		expect(kindsOf(doc)).toEqual(['paragraph', 'paragraph']);
		// The drop shrinks the end slice past the join, so the caret keeps the start offset.
		expect(collapsedCaret).toEqual({ path: [0], offset: 2 });
		expectParseConverged(doc);
	});

	// A tilde line inside the surviving body is text the run never terminated; the check must
	// not read it as a live opener and leave the stranded closer to absorb on reload.
	it('drops it past a foreign-marker open line in the surviving body', () => {
		const doc = parse('para\n\n```js\n~~~\nbody\n```\n\ntail\n');

		rangeDelete(
			doc,
			coverRange(doc, { path: [0], offset: 2 }, { path: [1], offset: 6 }),
			sharing(),
			fixtureReading(),
			'keyless'
		);

		expect(serialize(doc)).toBe('pa~~~\nbody\n\ntail\n');
		expectParseConverged(doc);
	});

	// The stranded run is legal GFM and what loaded markdown supplies, so it can be longer than
	// the opener the range took, which is exactly the shape the restore rule must not size to.
	it('drops a stranded closer longer than the deleted opener’s run', () => {
		const doc = parse('para\n\n~~~js\nbody\n~~~~~\n\ntail\n');

		rangeDelete(
			doc,
			coverRange(doc, { path: [0], offset: 2 }, { path: [1], offset: 8 }),
			sharing(),
			fixtureReading(),
			'keyless'
		);

		expect(serialize(doc)).toBe('pady\n\ntail\n');
		expectParseConverged(doc);
	});

	it('rejoins the survivor on the block’s own line ending (G4.20)', () => {
		const doc = parse('para\r\n\r\n```js\r\nbody\r\n```\r\n\r\ntail\r\n');

		rangeDelete(
			doc,
			coverRange(doc, { path: [0], offset: 2 }, { path: [1], offset: 9 }),
			sharing(),
			fixtureReading(),
			'keyless'
		);

		expect(serialize(doc)).toBe('pady\r\n\r\ntail\r\n');
		expectParseConverged(doc);
	});

	it('drops it when the code block sits inside a blockquote', () => {
		const doc = parse('para\n\n> ```js\n> body\n> ```\n\ntail\n');

		rangeDelete(
			doc,
			coverRange(doc, { path: [0], offset: 2 }, { path: [1, 0], offset: 8 }),
			sharing(),
			fixtureReading(),
			'keyless'
		);

		expect(serialize(doc)).toBe('pady\n\ntail\n');
		expectParseConverged(doc);
	});

	// A range consuming both fence lines leaves no run to strand and no metadata to restore from,
	// so neither rule may fire: the fence is gone, not broken.
	it('leaves a range that took both fence lines with nothing to reconcile', () => {
		const doc = parse('para\n\n```js\nbody\n```\n\ntail\n');

		rangeDelete(
			doc,
			coverRange(doc, { path: [0], offset: 2 }, { path: [1], offset: 14 }),
			sharing(),
			fixtureReading(),
			'keyless'
		);

		expect(serialize(doc)).toBe('pa\n\ntail\n');
		expectParseConverged(doc);
	});

	// The same-block branch writes raw in place with no reparse, so the node keeps a stale kind as
	// any kind would; the fence rule has to give bytes that stop absorbing the sibling.
	it('drops it on a range confined to the code block, freeing the sibling', () => {
		const doc = parse('```js\nbody\n```\n\ntail\n');

		rangeDelete(
			doc,
			coverRange(doc, { path: [0], offset: 0 }, { path: [0], offset: 8 }),
			sharing(),
			fixtureReading(),
			'keyless'
		);

		expect(serialize(doc)).toBe('dy\n\ntail\n');
		expect(parse(serialize(doc)).children.map((c) => c.kind)).toEqual(['paragraph', 'paragraph']);
	});

	it('drops it when the range starts in a table', () => {
		const doc = parse('| a | b |\n| --- | --- |\n| c | d |\n\n```js\nbody\n```\n\ntail\n');

		rangeDelete(
			doc,
			coverRange(doc, { path: [0], offset: 0 }, { path: [1], offset: 8 }),
			sharing(),
			fixtureReading(),
			'keyless'
		);

		expect(kindsOf(doc)).toEqual(['paragraph', 'paragraph']);
		expectParseConverged(doc);
	});

	describe('through the chrome wall', () => {
		beforeEach(registerCalloutForTests);

		it('drops it on the end truncation, which takes the opener and not the closer', () => {
			const doc = parse(':::callout Title\nInside\n:::\n\n```js\nbody\n```\n\ntail\n');

			rangeDelete(
				doc,
				coverRange(doc, { path: [0, 0], offset: 2 }, { path: [1], offset: 8 }),
				sharing(),
				fixtureReading(),
				'keyless'
			);

			expect(kindsOf(doc)).toEqual(['callout', 'paragraph', 'paragraph']);
			expect(doc.children[1].raw).toBe('dy\n');
			expectParseConverged(doc);
		});

		// The whole surviving tail is the closer line, so dropping it empties the endpoint; the
		// wall keeps that position rather than merging it away, so a placeholder holds the caret.
		it('drops a tail that is exactly the closer line', () => {
			const doc = parse(':::callout Title\nInside\n:::\n\n```js\nbody\n```\n\ntail\n');

			rangeDelete(
				doc,
				coverRange(doc, { path: [0, 0], offset: 2 }, { path: [1], offset: 11 }),
				sharing(),
				fixtureReading(),
				'keyless'
			);

			expect(kindsOf(doc)).toEqual(['callout', 'paragraph', 'paragraph']);
			expectParseConverged(doc);
		});
	});
});
