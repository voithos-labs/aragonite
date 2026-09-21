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
});

describe('generateBlockId', () => {
	// The whole requirement: these key Svelte's `{#each}`, and a repeat within one process puts
	// two live blocks at the same position.
	it('never repeats within the process', () => {
		const ids = new Set(Array.from({ length: 10_000 }, generateBlockId));
		expect(ids.size).toBe(10_000);
	});

	// A dev-server reload re-evaluates the module and restarts the counter, so the per-run prefix
	// is what keeps the ids created afterwards away from the ones the live tree already holds.
	it('carries a run prefix ahead of the sequence', () => {
		const [first, second] = [generateBlockId(), generateBlockId()];
		const prefixOf = (id: string) => id.slice(0, id.lastIndexOf('-'));
		expect(prefixOf(first)).toBe(prefixOf(second));
		expect(prefixOf(first).length).toBeGreaterThan(1);
	});
});
