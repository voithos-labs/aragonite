import { describe, it, expect } from 'vitest';
import { classifyBlockForSelection, type EditorSelection } from '../../selection/primitives';

function sel(
	anchor: { path: number[]; offset: number },
	focus: { path: number[]; offset: number }
): EditorSelection {
	return { anchor, focus };
}

describe('classifyBlockForSelection', () => {
	it('classifies blocks outside the range', () => {
		const s = sel({ path: [1], offset: 0 }, { path: [3], offset: 0 });
		expect(classifyBlockForSelection([0], s)).toBe('outside');
		expect(classifyBlockForSelection([4], s)).toBe('outside');
	});

	it('classifies the start block', () => {
		const s = sel({ path: [1], offset: 2 }, { path: [3], offset: 4 });
		expect(classifyBlockForSelection([1], s)).toBe('start');
	});

	it('classifies the end block', () => {
		const s = sel({ path: [1], offset: 2 }, { path: [3], offset: 4 });
		expect(classifyBlockForSelection([3], s)).toBe('end');
	});

	it('classifies middle blocks', () => {
		const s = sel({ path: [1], offset: 0 }, { path: [4], offset: 0 });
		expect(classifyBlockForSelection([2], s)).toBe('middle');
		expect(classifyBlockForSelection([3], s)).toBe('middle');
	});

	it('handles reverse selections via normalization', () => {
		const s = sel({ path: [4], offset: 0 }, { path: [1], offset: 0 });
		expect(classifyBlockForSelection([1], s)).toBe('start');
		expect(classifyBlockForSelection([4], s)).toBe('end');
		expect(classifyBlockForSelection([2], s)).toBe('middle');
		expect(classifyBlockForSelection([3], s)).toBe('middle');
	});

	it('returns single-block when start.path === end.path', () => {
		const s = sel({ path: [2], offset: 0 }, { path: [2], offset: 5 });
		expect(classifyBlockForSelection([2], s)).toBe('single-block');
	});

	it('handles cross-container nested paths', () => {
		const s = sel({ path: [0, 0], offset: 0 }, { path: [2, 1], offset: 0 });
		expect(classifyBlockForSelection([0, 0], s)).toBe('start');
		expect(classifyBlockForSelection([2, 1], s)).toBe('end');
		expect(classifyBlockForSelection([0, 1], s)).toBe('middle');
		expect(classifyBlockForSelection([1], s)).toBe('middle');
		expect(classifyBlockForSelection([2, 0], s)).toBe('middle');
	});
});
