import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('handleWholeBlockKeys — Mod+C / Mod+X clipboard', () => {
	let writeText: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
	});
	afterEach(() => vi.unstubAllGlobals());

	it.each([{ ctrlKey: true }, { metaKey: true }])(
		'Mod+C (%o) copies the trailing-trimmed raw and never deletes',
		async (mod) => {
			const { deps, deleteBlock } = makeDeps();
			const e = press('c', mod);
			handleWholeBlockKeys(e, deps);
			expect(e.preventDefault).toHaveBeenCalled();
			expect(writeText).toHaveBeenCalledWith('---');
			await Promise.resolve();
			expect(deleteBlock).not.toHaveBeenCalled();
		}
	);

	it('Mod+X copies the raw and deletes the block after the write resolves', async () => {
		const { deps, deleteBlock } = makeDeps();
		const e = press('x', { ctrlKey: true });
		handleWholeBlockKeys(e, deps);
		expect(e.preventDefault).toHaveBeenCalled();
		expect(writeText).toHaveBeenCalledWith('---');
		await vi.waitFor(() => expect(deleteBlock).toHaveBeenCalledWith(2));
	});

	it('Mod+X in reading mode still copies but deletes nothing', async () => {
		const { deps, deleteBlock } = makeDeps(() => true);
		handleWholeBlockKeys(press('x', { ctrlKey: true }), deps);
		expect(writeText).toHaveBeenCalledWith('---');
		await Promise.resolve();
		await Promise.resolve();
		expect(deleteBlock).not.toHaveBeenCalled();
	});

	it('Mod+X does not delete when the clipboard write rejects', async () => {
		writeText.mockRejectedValueOnce(new Error('clipboard denied'));
		const { deps, deleteBlock } = makeDeps();
		handleWholeBlockKeys(press('x', { ctrlKey: true }), deps);
		await Promise.resolve();
		await Promise.resolve();
		expect(deleteBlock).not.toHaveBeenCalled();
	});

	it('leaves Mod+Shift+C and Alt+C untouched (not a copy chord)', () => {
		const { deps } = makeDeps();
		const shifted = press('c', { ctrlKey: true, shiftKey: true });
		const alted = press('c', { ctrlKey: true, altKey: true });
		handleWholeBlockKeys(shifted, deps);
		handleWholeBlockKeys(alted, deps);
		expect(writeText).not.toHaveBeenCalled();
		expect(shifted.preventDefault).not.toHaveBeenCalled();
		expect(alted.preventDefault).not.toHaveBeenCalled();
	});
});
