import { describe, it, expect } from 'vitest';
import { parse } from '$lib/editor/core/parser';
import { lrdMapCouldChange } from '$lib/editor/lrd-map-gate';
import type { EditEvent } from '$lib/editor/editor-events';

function event(op: EditEvent['op'], path: number[], detail?: unknown): EditEvent {
	return { op, path, detail, timestamp: 0 } as EditEvent;
}

describe('lrdMapCouldChange', () => {
	it('skips the rebuild for an intra-block edit in an LRD-free doc', () => {
		const doc = parse('hello world\n');
		const e = event('input', [0], { byteLength: 1 });
		expect(lrdMapCouldChange(doc, e, '')).toBe(false);
	});

	it('rebuilds when the edited node itself is an LRD (signature non-empty)', () => {
		const doc = parse('see [d][d]\n\n[d]: https://example.com\n');
		const e = event('input', [1], { byteLength: 1 });
		expect(doc.children[1].kind).toBe('linkReferenceDefinition');
		expect(lrdMapCouldChange(doc, e, 'sig')).toBe(true);
	});

	it('rebuilds on a structural op even in an LRD-free doc', () => {
		const doc = parse('hello world\n');
		const e = event('split', [0], { at: 3 });
		expect(lrdMapCouldChange(doc, e, '')).toBe(true);
	});

	it('rebuilds when an intra-block edit turns the edited node into the first LRD', () => {
		const doc = parse('[d]: https://example.com\n');
		expect(doc.children[0].kind).toBe('linkReferenceDefinition');
		const e = event('updateContent', [0], { length: 24 });
		expect(lrdMapCouldChange(doc, e, '')).toBe(true);
	});

	it('conservatively rebuilds on a plain-block edit once any LRD exists (signature non-empty)', () => {
		const doc = parse('plain prose\n\n[d]: https://example.com\n');
		const e = event('input', [0], { byteLength: 1 });
		expect(doc.children[0].kind).not.toBe('linkReferenceDefinition');
		expect(lrdMapCouldChange(doc, e, 'sig')).toBe(true);
	});
});
