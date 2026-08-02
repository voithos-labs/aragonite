import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { rangeDelete } from '$lib/selection/range-delete';
import { createSharingState } from '$lib/tree-operations/sharing';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import { expectParseConverged } from '../harness/parse-converged';

// Issue #58, the mirror of #55: a range whose END endpoint sits in a code body consumes the
// OPENER, and the surviving closer reparses as a NEW unclosed fence that eats the live siblings
// below. Miss-analysis: the #55 pins drove ranges STARTING in a code body, the only shape that
// loses the closer; the generic merge normalized the joined raw against START's rule alone, so
// no pin could reach the end block's rule with an end-side slice.

const sharing = () => createSharingState();

const kindsOf = (doc: ReturnType<typeof parse>) => doc.children.map((c) => c.kind);

describe('range delete that consumes a fenced code opener', () => {
	it('drops the closer the cross-block merge stranded', () => {
		const doc = parse('para\n\n```js\nbody\n```\n\ntail\n');

		const { collapsedCaret } = rangeDelete(
			doc,
			{ path: [0], offset: 2 },
			{ path: [1], offset: 8 },
			sharing(),
			undefined
		);

		expect(serialize(doc)).toBe('pady\n\ntail\n');
		expect(kindsOf(doc)).toEqual(['paragraph', 'paragraph']);
		// The drop shrinks the END slice past the join, so the caret keeps the start offset.
		expect(collapsedCaret).toEqual({ path: [0], offset: 2 });
		expectParseConverged(doc);
	});

	// A tilde line inside the surviving body is text the run never terminated — the guard must
	// not read it as a live opener and leave the stranded closer to absorb on reload.
	it('drops it past a foreign-marker open line in the surviving body', () => {
		const doc = parse('para\n\n```js\n~~~\nbody\n```\n\ntail\n');

		rangeDelete(doc, { path: [0], offset: 2 }, { path: [1], offset: 6 }, sharing(), undefined);

		expect(serialize(doc)).toBe('pa~~~\nbody\n\ntail\n');
		expectParseConverged(doc);
	});

	// The stranded run is legal GFM and what loaded markdown supplies, so it can be LONGER than
	// the opener the range took — which is exactly the shape the restore rule must not size to.
	it('drops a stranded closer longer than the deleted opener’s run', () => {
		const doc = parse('para\n\n~~~js\nbody\n~~~~~\n\ntail\n');

		rangeDelete(doc, { path: [0], offset: 2 }, { path: [1], offset: 8 }, sharing(), undefined);

		expect(serialize(doc)).toBe('pady\n\ntail\n');
		expectParseConverged(doc);
	});

	it('rejoins the survivor on the block’s own line ending (G4.20)', () => {
		const doc = parse('para\r\n\r\n```js\r\nbody\r\n```\r\n\r\ntail\r\n');

		rangeDelete(doc, { path: [0], offset: 2 }, { path: [1], offset: 9 }, sharing(), undefined);

		expect(serialize(doc)).toBe('pady\r\n\r\ntail\r\n');
		expectParseConverged(doc);
	});

	it('drops it when the code block sits inside a blockquote', () => {
		const doc = parse('para\n\n> ```js\n> body\n> ```\n\ntail\n');

		rangeDelete(doc, { path: [0], offset: 2 }, { path: [1, 0], offset: 8 }, sharing(), undefined);

		expect(serialize(doc)).toBe('pady\n\ntail\n');
		expectParseConverged(doc);
	});

	// A range consuming BOTH fence lines leaves no run to strand and no metadata to restore from,
	// so neither arm may fire: the fence is gone, not broken.
	it('leaves a range that took both fence lines with nothing to reconcile', () => {
		const doc = parse('para\n\n```js\nbody\n```\n\ntail\n');

		rangeDelete(doc, { path: [0], offset: 2 }, { path: [1], offset: 14 }, sharing(), undefined);

		expect(serialize(doc)).toBe('pa\n\ntail\n');
		expectParseConverged(doc);
	});

	// The same-block arm writes raw in place with no reparse behind it, so the node keeps the
	// kind its bytes no longer describe. That staleness is the arm's own, kind-generic (a heading
	// losing its `#` does the same); what the fence rule owes here is bytes that stop absorbing.
	it('drops it on a range confined to the code block, freeing the sibling', () => {
		const doc = parse('```js\nbody\n```\n\ntail\n');

		rangeDelete(doc, { path: [0], offset: 0 }, { path: [0], offset: 8 }, sharing(), undefined);

		expect(serialize(doc)).toBe('dy\n\ntail\n');
		expect(parse(serialize(doc)).children.map((c) => c.kind)).toEqual(['paragraph', 'paragraph']);
	});

	it('drops it when the range starts in a table', () => {
		const doc = parse('| a | b |\n| --- | --- |\n| c | d |\n\n```js\nbody\n```\n\ntail\n');

		rangeDelete(doc, { path: [0], offset: 0 }, { path: [1], offset: 8 }, sharing(), undefined);

		expect(kindsOf(doc)).toEqual(['paragraph', 'paragraph']);
		expectParseConverged(doc);
	});

	describe('through the chrome wall', () => {
		beforeEach(() => {
			// registerChromeLeaf registers a paste surface; the schema reset alone leaves it
			// orphaned, so a re-register would collide.
			__resetSchemaRegistriesForTests();
			__resetPasteSurfacesForTests();
			registerCalloutKind();
		});

		it('drops it on the end truncation, which takes the opener and not the closer', () => {
			const doc = parse(':::callout Title\nInside\n:::\n\n```js\nbody\n```\n\ntail\n');

			rangeDelete(doc, { path: [0, 0], offset: 2 }, { path: [1], offset: 8 }, sharing(), undefined);

			expect(kindsOf(doc)).toEqual(['callout', 'paragraph', 'paragraph']);
			expect(doc.children[1].raw).toBe('dy\n');
			expectParseConverged(doc);
		});

		// The whole surviving tail IS the closer line, so dropping it empties the endpoint; the
		// wall keeps that slot rather than merging it away, so a placeholder holds the caret.
		it('drops a tail that is exactly the closer line', () => {
			const doc = parse(':::callout Title\nInside\n:::\n\n```js\nbody\n```\n\ntail\n');

			rangeDelete(
				doc,
				{ path: [0, 0], offset: 2 },
				{ path: [1], offset: 11 },
				sharing(),
				undefined
			);

			expect(kindsOf(doc)).toEqual(['callout', 'paragraph', 'paragraph']);
			expect(parse(serialize(doc)).children.length).toBe(2);
			expectParseConverged(doc);
		});
	});
});
