import { describe, it, expect, vi } from 'vitest';
import {
	handleWholeBlockKeys,
	type WholeBlockKeyDeps
} from '$lib/editor-actions/container-block-component';
import { displayLength } from '$lib/core/lines';

function makeDeps(isReading = () => false) {
	const splitBlock = vi.fn();
	const deleteBlock = vi.fn();
	const moveFocus = vi.fn();
	const deps: WholeBlockKeyDeps = {
		getIndex: () => 2,
		getRaw: () => '---\n',
		blockEdit: { splitBlock, deleteBlock },
		focus: { moveFocus },
		isReading
	};
	return { deps, splitBlock, deleteBlock, moveFocus };
}

function press(key: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
	return {
		key,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		...mods,
		preventDefault: vi.fn()
	} as unknown as KeyboardEvent;
}

describe('handleWholeBlockKeys', () => {
	it('Enter inserts a sibling below at end of content', () => {
		const { deps, splitBlock } = makeDeps();
		const e = press('Enter');
		handleWholeBlockKeys(e, deps);
		expect(splitBlock).toHaveBeenCalledWith(2, displayLength('---\n'));
		expect(e.preventDefault).toHaveBeenCalled();
	});

	it.each(['Backspace', 'Delete'])('%s removes the block', (key) => {
		const { deps, deleteBlock } = makeDeps();
		handleWholeBlockKeys(press(key), deps);
		expect(deleteBlock).toHaveBeenCalledWith(2);
	});

	it('the edit branches gate on reading mode but still consume the key', () => {
		const { deps, splitBlock, deleteBlock } = makeDeps(() => true);
		const enter = press('Enter');
		handleWholeBlockKeys(enter, deps);
		handleWholeBlockKeys(press('Backspace'), deps);
		expect(splitBlock).not.toHaveBeenCalled();
		expect(deleteBlock).not.toHaveBeenCalled();
		expect(enter.preventDefault).toHaveBeenCalled();
	});

	it.each([
		['ArrowUp', 1, { stickyColumnFrom: 'below' }],
		['ArrowLeft', 1, 'end'],
		['ArrowDown', 3, { stickyColumnFrom: 'above' }],
		['ArrowRight', 3, 'start']
	] as const)('%s traverses to the neighbour', (key, target, position) => {
		const { deps, moveFocus } = makeDeps();
		handleWholeBlockKeys(press(key), deps);
		expect(moveFocus).toHaveBeenCalledWith(target, position);
	});

	it('arrow traversal stays live in reading mode', () => {
		const { deps, moveFocus } = makeDeps(() => true);
		handleWholeBlockKeys(press('ArrowDown'), deps);
		expect(moveFocus).toHaveBeenCalledWith(3, { stickyColumnFrom: 'above' });
	});

	it('leaves a modified arrow (Alt+Arrow reorder) to the caller', () => {
		const { deps, moveFocus } = makeDeps();
		const e = press('ArrowUp', { altKey: true });
		handleWholeBlockKeys(e, deps);
		expect(moveFocus).not.toHaveBeenCalled();
		expect(e.preventDefault).not.toHaveBeenCalled();
	});

	it('ignores a printable key', () => {
		const { deps, splitBlock, deleteBlock, moveFocus } = makeDeps();
		const e = press('a');
		handleWholeBlockKeys(e, deps);
		expect(splitBlock).not.toHaveBeenCalled();
		expect(deleteBlock).not.toHaveBeenCalled();
		expect(moveFocus).not.toHaveBeenCalled();
		expect(e.preventDefault).not.toHaveBeenCalled();
	});
});
