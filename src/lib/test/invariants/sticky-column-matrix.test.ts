import { describe, it, expect, type Mock } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import type { BlockEditActions } from '$lib/action-contracts';
import { classifyStickyKey, PRESERVE_KEYS_NON_ARROW } from '$lib/cursor/sticky-column';
import { eventToChord } from '$lib/schema/keybindings';
import { makeEditorActionsDeps, makeNode } from '$lib/test/harness/editor-actions';

// G2.10 sticky-column matrix: the key→action decision every keydown path enacts, and the
// structural reset policy. The state object's own guards live in cursor/sticky-column.test.ts.

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

	// Two hand-written bare-modifier lists that disagree silently drop the column mid-run:
	// a key the chord parser ignores but the sticky list does not know about.
	it('every bare modifier the chord parser ignores also preserves', () => {
		const press = (key: string) =>
			({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }) as KeyboardEvent;
		for (const key of ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock']) {
			expect(eventToChord(press(key))).toBeNull();
			expect(classifyStickyKey(key)).toBe('preserve');
		}
	});

	it('typing keys reset', () => {
		for (const key of ['a', 'Z', '1', ' ', 'Enter', 'Backspace', 'Home', 'End', 'Tab']) {
			expect(classifyStickyKey(key)).toBe('reset');
		}
	});

	// Mutation guard: the three branches must be mutually exclusive and total.
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

// A column captured against the old layout is stale once the shape changes, so real ops
// are asserted to honor the commit primitive's unconditional reset.

describe('G2.10 structural reset policy', () => {
	async function exercise(run: (actions: BlockEditActions) => void | Promise<void>): Promise<Mock> {
		const { deps } = makeEditorActionsDeps([makeNode('paragraph', 'hello world\n')]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);
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
