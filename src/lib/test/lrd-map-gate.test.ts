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
		// The common case with many definitions: typing in a paragraph that uses a reference can
		// never change the set of definitions, so it must not traverse the document.
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

	it('rebuilds on a kind change that deletes a definition (post-edit node is now prose)', () => {
		// It has to rebuild even though the node is no longer a link reference definition after the
		// edit, or the resolver keeps serving the deleted definition.
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
		// The G4.7 rule for the memo: a counter that bumped on every rebuild would invalidate every
		// block containing a bracket on every commit.
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
