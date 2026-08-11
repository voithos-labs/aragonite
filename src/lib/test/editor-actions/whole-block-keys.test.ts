import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	handleWholeBlockKeys,
	type WholeBlockKeyDeps
} from '$lib/editor-actions/container-block-component';
import { displayLength } from '$lib/core/lines';
import { createStickyColumnState, type StickyColumnState } from '$lib/cursor/sticky-column';
import { asEditorX } from '$lib/cursor/coordinate-spaces';
import { createEdgeAffinityState } from '$lib/cursor/edge-affinity';

function makeDeps(isReading = () => false) {
	const splitBlock = vi.fn();
	const deleteBlock = vi.fn();
	const insertParagraph = vi.fn();
	const moveFocus = vi.fn();
	const stickyColumn = createStickyColumnState();
	const edgeAffinity = createEdgeAffinityState();
	const deps: WholeBlockKeyDeps = {
		getIndex: () => 2,
		getRaw: () => '---\n',
		blockEdit: { splitBlock, deleteBlock, insertParagraph },
		focus: { moveFocus },
		isReading,
		stickyColumn,
		edgeAffinity
	};
	return {
		deps,
		splitBlock,
		deleteBlock,
		insertParagraph,
		moveFocus,
		stickyColumn,
		edgeAffinity
	};
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

/** Seeds the column the way a real vertical run does: through the door, not `capture`. */
function seedColumn(stickyColumn: StickyColumnState, x: number): void {
	stickyColumn.noteKey({ key: 'ArrowDown', altKey: false }, () => asEditorX(x));
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

	// Miss-analysis: this file's own printable case asserted the drop it should have questioned —
	// every branch was pinned except the key class with no branch at all.
	it.each(['a', 'A', ' ', 'é'])('the printable %o mints a paragraph below carrying it', (key) => {
		const { deps, insertParagraph, splitBlock, moveFocus } = makeDeps();
		const e = press(key, { shiftKey: key === 'A' });
		handleWholeBlockKeys(e, deps);
		expect(insertParagraph).toHaveBeenCalledWith(3, key);
		expect(splitBlock).not.toHaveBeenCalled();
		expect(moveFocus).not.toHaveBeenCalled();
		expect(e.preventDefault).toHaveBeenCalled();
	});

	it('the printable mint gates on reading mode but still consumes the key', () => {
		const { deps, insertParagraph } = makeDeps(() => true);
		const e = press('a');
		handleWholeBlockKeys(e, deps);
		expect(insertParagraph).not.toHaveBeenCalled();
		expect(e.preventDefault).toHaveBeenCalled();
	});

	it('declines a mid-composition character, whose bytes the IME has not committed', () => {
		const { deps, insertParagraph } = makeDeps();
		const e = press('a', { isComposing: true });
		handleWholeBlockKeys(e, deps);
		expect(insertParagraph).not.toHaveBeenCalled();
		expect(e.preventDefault).not.toHaveBeenCalled();
	});

	it('leaves a chorded character to the caller', () => {
		const { deps, insertParagraph } = makeDeps();
		const e = press('b', { altKey: true });
		handleWholeBlockKeys(e, deps);
		expect(insertParagraph).not.toHaveBeenCalled();
		expect(e.preventDefault).not.toHaveBeenCalled();
	});
});

// With no caret to measure, the surface routes the key through `noteKey` with no
// measureX. Without it a column outlives a horizontal traversal and, since `capture` is
// idempotent, the next ArrowDown in the landing block reuses the stale pixel X.
describe('handleWholeBlockKeys: sticky column', () => {
	afterEach(() => vi.unstubAllGlobals());

	it.each(['ArrowLeft', 'ArrowRight'])(
		'%s clears a column left by an earlier vertical run',
		(key) => {
			const { deps, stickyColumn } = makeDeps();
			seedColumn(stickyColumn, 200);
			expect(stickyColumn.get()).toBe(200);
			handleWholeBlockKeys(press(key), deps);
			expect(stickyColumn.get()).toBeNull();
		}
	);

	it.each(['ArrowUp', 'ArrowDown'])(
		'%s preserves the column so the vertical run continues',
		(key) => {
			const { deps, stickyColumn } = makeDeps();
			seedColumn(stickyColumn, 200);
			handleWholeBlockKeys(press(key), deps);
			expect(stickyColumn.get()).toBe(200);
		}
	);

	it.each(['Enter', 'Backspace', 'Delete', 'a'])('%s clears the column', (key) => {
		const { deps, stickyColumn } = makeDeps();
		seedColumn(stickyColumn, 200);
		handleWholeBlockKeys(press(key), deps);
		expect(stickyColumn.get()).toBeNull();
	});

	it('Mod+X clears the column', () => {
		vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
		const { deps, stickyColumn } = makeDeps();
		seedColumn(stickyColumn, 200);
		handleWholeBlockKeys(press('x', { ctrlKey: true }), deps);
		expect(stickyColumn.get()).toBeNull();
	});

	// Belt-and-suspenders: both callers consume the reorder chord before the shared tail,
	// but the door declines it anyway.
	it('Alt+ArrowUp (the reorder chord) neither clears nor recaptures', () => {
		const { deps, stickyColumn } = makeDeps();
		seedColumn(stickyColumn, 200);
		handleWholeBlockKeys(press('ArrowUp', { altKey: true }), deps);
		expect(stickyColumn.get()).toBe(200);
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
