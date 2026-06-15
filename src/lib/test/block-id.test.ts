import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { assignIds, generateBlockId } from '../block-id';

describe('assignIds', () => {
	it('returns an array of unique IDs matching children length', () => {
		const doc = parse('# A\n\n# B\n\n# C\n');
		const ids = assignIds(doc.children);

		expect(ids).toHaveLength(3);
		expect(new Set(ids).size).toBe(3);
	});

	it('generates unique IDs (UUIDs)', () => {
		const id1 = generateBlockId();
		const id2 = generateBlockId();
		expect(id1).not.toBe(id2);
		expect(typeof id1).toBe('string');
		expect(id1.length).toBeGreaterThan(0);
	});
});
