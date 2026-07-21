import { describe, it, expect, type Mock } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import type { BlockEditActions } from '$lib/action-contracts';
import { classifyStickyKey, PRESERVE_KEYS_NON_ARROW } from '$lib/cursor/sticky-column';
import { makeEditorActionsDeps, makeNode } from '$lib/test/harness/editor-actions';

// G2.10 sticky-column matrix. The idempotent-capture and non-finite guards live
// on the state object itself and are covered in cursor/sticky-column.test.ts;
// here we pin the two faces the plan calls out that those tests don't reach:
// (1) the key→action decision the shared keydown prelude enacts
// (classifyStickyKey, which shared-keydown.ts consumes), and (2) the structural
// reset policy — commit ceremony resets sticky on every structural op.

// ── Decision matrix (classifyStickyKey) ──────────────────────────────────────

describe('G2.10 classifyStickyKey decision matrix', () => {
	it('vertical arrows capture', () => {
		expect(classifyStickyKey('ArrowUp')).toBe('capture');
		expect(classifyStickyKey('ArrowDown')).toBe('capture');
	});

	it('horizontal arrows reset (caret moves horizontally — intent abandoned)', () => {
		expect(classifyStickyKey('ArrowLeft')).toBe('reset');
		expect(classifyStickyKey('ArrowRight')).toBe('reset');
	});

	it('every documented preserve key preserves', () => {
		for (const key of PRESERVE_KEYS_NON_ARROW) {
			expect(classifyStickyKey(key)).toBe('preserve');
		}
	});

	it('typing keys reset', () => {
		for (const key of ['a', 'Z', '1', ' ', 'Enter', 'Backspace', 'Home', 'End', 'Tab']) {
			expect(classifyStickyKey(key)).toBe('reset');
		}
	});

	// Mutation guard: the three branches must be mutually exclusive and total —
	// no key falls through to a different bucket than intended.
	it('partitions keys: capture ∩ preserve ∩ reset are disjoint', () => {
		const arrows = ['ArrowUp', 'ArrowDown'];
		for (const key of arrows) expect(classifyStickyKey(key)).toBe('capture');
		for (const key of PRESERVE_KEYS_NON_ARROW) {
			expect(arrows).not.toContain(key);
			expect(classifyStickyKey(key)).not.toBe('capture');
			expect(classifyStickyKey(key)).not.toBe('reset');
		}
	});
});

// ── Structural reset policy ──────────────────────────────────────────────────

// A structural commit must drop the sticky column: the document shape changed,
// so a column captured against the old layout is stale. The commit primitive
// resets unconditionally; assert real ops honor it via the spied state.

describe('G2.10 structural reset policy', () => {
	async function exercise(run: (actions: BlockEditActions) => void | Promise<void>): Promise<Mock> {
		const { deps } = makeEditorActionsDeps([makeNode('paragraph', 'hello world\n')]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);
		// makeStickyColumn() in the harness backs reset/capture with vi.fn().
		const reset = deps.stickyColumn.reset as Mock;
		reset.mockClear();
		await run(actions);
		return reset;
	}

	it('split resets sticky column', async () => {
		const reset = await exercise((a) => a.splitBlock(0, 3));
		expect(reset).toHaveBeenCalled();
	});

	it('replaceBlock (structural paste live path) resets sticky column', async () => {
		const reset = await exercise((a) => a.replaceBlock(0, [makeNode('paragraph', 'pasted\n')]));
		expect(reset).toHaveBeenCalled();
	});

	it('delete resets sticky column', async () => {
		const reset = await exercise((a) => a.deleteBlock(0));
		expect(reset).toHaveBeenCalled();
	});
});
