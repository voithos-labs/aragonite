import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { advanceSignatureEpoch, lrdMapCouldChange } from '$lib/components/lrd-map-gate';
import { buildLinkReferenceMap } from '$lib/core/inline/link-reference-resolver';
import type { EditEvent } from '$lib/editor-events';

function event(op: EditEvent['op'], path: number[], detail?: unknown): EditEvent {
	return { op, path, detail, timestamp: 0 } as EditEvent;
}

describe('lrdMapCouldChange', () => {
	it('skips the rebuild for an ordinary paragraph keystroke', () => {
		const doc = parse('hello world\n');
		expect(lrdMapCouldChange(doc, event('input', [0], { byteLength: 1 }))).toBe(false);
	});

	it('skips the rebuild for a paragraph keystroke even when the doc holds LRDs', () => {
		// The definition-dense hot path: typing in a reference-USING paragraph can
		// never change the definition SET, so it must not walk the doc.
		const doc = parse('use [d][d]\n\n[d]: https://example.com\n');
		expect(doc.children[0].kind).not.toBe('linkReferenceDefinition');
		expect(lrdMapCouldChange(doc, event('input', [0], { byteLength: 1 }))).toBe(false);
	});

	it('rebuilds when a kind-stable edit targets a definition node', () => {
		const doc = parse('see [d][d]\n\n[d]: https://example.com\n');
		expect(doc.children[1].kind).toBe('linkReferenceDefinition');
		expect(lrdMapCouldChange(doc, event('input', [1], { byteLength: 1 }))).toBe(true);
	});

	it('rebuilds on a kind change that creates a definition (commits as updateContent)', () => {
		const doc = parse('[d]: https://example.com\n');
		expect(doc.children[0].kind).toBe('linkReferenceDefinition');
		expect(lrdMapCouldChange(doc, event('updateContent', [0], { length: 24 }))).toBe(true);
	});

	it('rebuilds on a kind change that DELETES a definition (post-edit node is now prose)', () => {
		// The gate must rebuild despite the post-edit node no longer being an LRD, or
		// the resolver keeps serving the deleted definition.
		const doc = parse('plain prose now\n');
		expect(doc.children[0].kind).not.toBe('linkReferenceDefinition');
		expect(lrdMapCouldChange(doc, event('updateContent', [0], { length: 15 }))).toBe(true);
	});

	it('rebuilds on a structural op', () => {
		const doc = parse('hello world\n');
		expect(lrdMapCouldChange(doc, event('split', [0], { at: 3 }))).toBe(true);
	});
});

describe('advanceSignatureEpoch', () => {
	const sigOf = (src: string) => buildLinkReferenceMap(parse(src).children).signature;

	it('holds the epoch when a rebuild yields an identical signature', () => {
		// The G4.7 memo-semantics constraint: a stamp that bumped on every rebuild
		// would over-invalidate every bracket-bearing block per commit.
		const sig = sigOf('[d]: https://example.com\n');
		const held = advanceSignatureEpoch(sig, 5, sigOf('[d]: https://example.com\n'));
		expect(held.epoch).toBe(5);
		expect(held.signature).toBe(sig);
	});

	it('bumps the epoch once when a definition edit changes the signature', () => {
		const before = sigOf('[d]: https://old.com\n');
		const after = sigOf('[d]: https://new.com\n');
		expect(after).not.toBe(before);
		const bumped = advanceSignatureEpoch(before, 5, after);
		expect(bumped.epoch).toBe(6);
		expect(bumped.signature).toBe(after);
	});
});
