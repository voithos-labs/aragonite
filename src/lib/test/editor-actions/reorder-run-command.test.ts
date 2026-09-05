import { describe, it, expect, vi } from 'vitest';
import { reorderRunCommand } from '$lib/editor-actions/reorder-action';

describe('reorderRunCommand', () => {
	it.each([
		['block.moveUp', -1],
		['block.moveDown', 1]
	] as const)('%s nudges the unit at the live path by %i and claims the id', (id, dir) => {
		const nudgeReorderUnit = vi.fn().mockResolvedValue(undefined);

		expect(reorderRunCommand(id, { nudgeReorderUnit }, () => [2, 1])).toBe(true);

		expect(nudgeReorderUnit).toHaveBeenCalledWith([2, 1], dir);
	});

	it('declines every other id without touching the reorder service', () => {
		const nudgeReorderUnit = vi.fn();

		expect(reorderRunCommand('block.split', { nudgeReorderUnit }, () => [0])).toBe(false);

		expect(nudgeReorderUnit).not.toHaveBeenCalled();
	});
});
