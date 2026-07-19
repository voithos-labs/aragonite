import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { lrdMapCouldChange } from '$lib/components/lrd-map-gate';
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
		// paragraph → LRD: the post-edit node is the new definition.
		const doc = parse('[d]: https://example.com\n');
		expect(doc.children[0].kind).toBe('linkReferenceDefinition');
		expect(lrdMapCouldChange(doc, event('updateContent', [0], { length: 24 }))).toBe(true);
	});

	it('rebuilds on a kind change that DELETES a definition (post-edit node is now prose)', () => {
		// LRD → paragraph: a kind change commits as `updateContent`, never `input`,
		// so the gate rebuilds despite the post-edit node no longer being an LRD —
		// without this the resolver would keep serving the deleted definition.
		const doc = parse('plain prose now\n');
		expect(doc.children[0].kind).not.toBe('linkReferenceDefinition');
		expect(lrdMapCouldChange(doc, event('updateContent', [0], { length: 15 }))).toBe(true);
	});

	it('rebuilds on a structural op', () => {
		const doc = parse('hello world\n');
		expect(lrdMapCouldChange(doc, event('split', [0], { at: 3 }))).toBe(true);
	});
});
