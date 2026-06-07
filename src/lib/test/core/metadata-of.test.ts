import { describe, it, expect } from 'vitest';
import { metadataOf, type CstNode } from '../../core/nodes';

describe('metadataOf — typed metadata accessor', () => {
	it('returns the node metadata typed for the requested kind', () => {
		const table = {
			kind: 'table',
			leadingTrivia: '',
			raw: '',
			metadata: { columnCount: 3, alignments: ['none', 'left', 'right'] }
		} as CstNode;
		const meta = metadataOf(table, 'table');
		expect(meta.columnCount).toBe(3);
		expect(meta.alignments).toEqual(['none', 'left', 'right']);
	});

	it('reads list-item metadata fields', () => {
		const item = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '',
			metadata: { marker: '- ', taskItem: true, taskChecked: false, taskMarker: '[ ]' }
		} as CstNode;
		expect(metadataOf(item, 'listItem').marker).toBe('- ');
		expect(metadataOf(item, 'listItem').taskChecked).toBe(false);
	});
});
