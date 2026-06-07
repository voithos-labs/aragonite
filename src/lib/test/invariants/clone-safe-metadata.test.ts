import { describe, it, expect } from 'vitest';
import { checkCloneSafeMetadata } from '../../invariants/node-shape';
import { parse } from '../../core/parser';
import type { CstNode } from '../../core/nodes';

function firstBlock(source: string): CstNode {
	return parse(source).children[0];
}

describe('checkCloneSafeMetadata (G1.6)', () => {
	function withMetadata(meta: Record<string, unknown>): CstNode {
		const node = firstBlock('# Title\n');
		node.metadata = meta as unknown as CstNode['metadata'];
		return node;
	}

	it('fires when a metadata value is a nested object', () => {
		const violation = checkCloneSafeMetadata(withMetadata({ level: 1, extra: { nested: 1 } }));
		expect(violation?.code).toBe('metadata-not-clone-safe');
		expect(violation?.detail).toEqual({ kind: 'heading', field: 'extra' });
	});

	it('fires when a metadata value is an array of objects', () => {
		const violation = checkCloneSafeMetadata(withMetadata({ level: 1, rows: [{ a: 1 }] }));
		expect(violation?.detail).toEqual({ kind: 'heading', field: 'rows' });
	});

	it('passes for real heading metadata (primitives)', () => {
		expect(checkCloneSafeMetadata(firstBlock('## Heading\n'))).toBeNull();
	});

	it('passes for real table metadata (string array)', () => {
		const table = firstBlock('| a | b |\n| :-- | --: |\n| 1 | 2 |\n');
		expect(checkCloneSafeMetadata(table)).toBeNull();
	});

	it('passes for a node with no metadata', () => {
		expect(checkCloneSafeMetadata(firstBlock('plain\n'))).toBeNull();
	});

	it('treats null metadata values as clone-safe', () => {
		const item = parse('- task\n').children[0].children![0];
		expect(item.kind).toBe('listItem');
		expect(checkCloneSafeMetadata(item)).toBeNull();
	});
});
