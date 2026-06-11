import { describe, it, expect } from 'vitest';
import { parse } from '../../../core/parser';
import { collectInlineDirty } from '../../../core/inline/dirty-set';
import type { EditEvent } from '../../../editor-events';

const doc = parse('first\n\n- item one\n- item two\n\nthird\n');

describe('collectInlineDirty', () => {
	const subtreeEvents: EditEvent[] = [
		{ op: 'input', path: [1, 0], detail: { byteLength: 1 }, timestamp: 0 },
		{ op: 'updateContent', path: [1, 0], detail: { length: 5 }, timestamp: 0 },
		{ op: 'metadataUpdate', path: [1, 0], detail: { fields: ['url'] }, timestamp: 0 }
	];

	it('scopes intra-block ops to the top-level subtree containing the edit', () => {
		for (const event of subtreeEvents) {
			expect(collectInlineDirty(doc, event, false)).toEqual([doc.children[1]]);
		}
	});

	it('returns whole-doc when the LRD signature changed, even for intra-block ops', () => {
		for (const event of subtreeEvents) {
			expect(collectInlineDirty(doc, event, true)).toBe('all');
		}
	});

	it('returns whole-doc for structural ops', () => {
		const structuralEvents: EditEvent[] = [
			{ op: 'split', path: [0], detail: { at: 2 }, timestamp: 0 },
			{ op: 'merge', path: [1], detail: { direction: 'prev' }, timestamp: 0 },
			{ op: 'delete', path: [0], timestamp: 0 },
			{ op: 'paste', path: [0], detail: { count: 2 }, timestamp: 0 },
			{ op: 'undo', path: [0], timestamp: 0 },
			{ op: 'redo', path: [0], timestamp: 0 },
			{ op: 'tableInsertRow', path: [1], detail: { rowIdx: 0, side: 'below' }, timestamp: 0 }
		];
		for (const event of structuralEvents) {
			expect(collectInlineDirty(doc, event, false)).toBe('all');
		}
	});

	it('falls back to whole-doc when the event path is out of range', () => {
		const event: EditEvent = { op: 'input', path: [99], detail: { byteLength: 1 }, timestamp: 0 };
		expect(collectInlineDirty(doc, event, false)).toBe('all');
	});
});
