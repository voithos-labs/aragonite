import { describe, it, expect } from 'vitest';
import {
	blockPaintsWholeBox,
	classifyBlockForSelection,
	type EditorSelection
} from '../../selection/primitives';

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

// Miss-analysis: every overlay case pinned the document-order class, and none asked which block
// paints the box, so a container's own decoration (a GitHub alert's badge, with no child host to
// paint it) went unpainted under a range that held the whole block (#321).
describe('blockPaintsWholeBox', () => {
	it('paints a leaf the range holds whole, and nothing outside the range', () => {
		const s = sel({ path: [1], offset: 0 }, { path: [4], offset: 0 });
		expect(blockPaintsWholeBox([2], s, null)).toBe(true);
		expect(blockPaintsWholeBox([0], s, null)).toBe(false);
		expect(blockPaintsWholeBox([9], s, null)).toBe(false);
		expect(blockPaintsWholeBox([1], s, null)).toBe(false);
		expect(blockPaintsWholeBox([4], s, null)).toBe(false);
	});

	it('paints the container whose subtree the range holds, never its children', () => {
		const s = sel({ path: [0], offset: 0 }, { path: [2], offset: 0 });
		expect(blockPaintsWholeBox([1], s, null)).toBe(true);
		expect(blockPaintsWholeBox([1, 0], s, null)).toBe(false);
		expect(blockPaintsWholeBox([1, 1, 0], s, null)).toBe(false);
	});

	it('leaves an ancestor of the end endpoint to its children', () => {
		const s = sel({ path: [0], offset: 0 }, { path: [1, 1], offset: 2 });
		expect(blockPaintsWholeBox([1], s, null)).toBe(false);
		expect(blockPaintsWholeBox([1, 0], s, null)).toBe(true);
		expect(blockPaintsWholeBox([1, 1], s, null)).toBe(false);
	});

	it('paints the whole unit of a single-block range and nothing beside it', () => {
		const s = sel({ path: [1], offset: 0 }, { path: [1], offset: 7 });
		expect(blockPaintsWholeBox([1], s, [1])).toBe(true);
		expect(blockPaintsWholeBox([1, 0], s, [1])).toBe(false);
		expect(blockPaintsWholeBox([2], s, [1])).toBe(false);
		expect(blockPaintsWholeBox([1], s, null)).toBe(false);
	});
});
