// @vitest-environment jsdom
// ThematicBreakBlock is the reference whole-block-focus kind: the block is its own focus target.
// Key meanings live in `whole-block-keys.test.ts`; this file covers what only a mount shows: the
// focus element the block publishes, and its keydown order (editor-global chord, kind keymap,
// default keys) with its own reading-mode check.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { displayLength } from '$lib/core/lines';
import { WHOLE_BLOCK_INPUT_ATTR } from '$lib/editor-actions/whole-block-focus-surface';
import {
	BREAK_INDEX as INDEX,
	BREAK_RAW as RAW,
	mountBreak,
	type MountedBreak
} from './mount-break';
import { dispatchKey } from '$lib/test/harness/settle';

let mounted: MountedBreak;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	document.body.innerHTML = '';
});

describe('thematic break: the whole-block focus surface', () => {
	// Miss-analysis: no test read the two tabindexes together, so a second tab stop went unseen.
	it('renders a separator and declares itself non-editable, with the host as its one tab stop', () => {
		mounted = mountBreak();
		const rule = mounted.el.querySelector('.thematic-break-rule') as HTMLElement;
		const host = mounted.el.querySelector(`[${WHOLE_BLOCK_INPUT_ATTR}]`) as HTMLElement;

		// The focusable wrapper takes no role, since a focusable separator is a slider to ARIA.
		expect(rule.hasAttribute('role')).toBe(false);
		expect(rule.tabIndex).toBe(-1);
		expect(host.tabIndex).toBe(0);
		expect(host.getAttribute('aria-label')).toBe('Divider');
		expect(rule.querySelector('hr')).not.toBeNull();
		expect(mounted.instance.editable).toBe(false);
		expect(mounted.instance.focusable).toBe(true);
	});

	it('reports no cursor offset before the caret sits', () => {
		mounted = mountBreak();
		expect(mounted.instance.getCursorOffset()).toBeNull();
	});

	// Focusing a whole block places no caret, so `focus` has to end a live cross-block range
	// itself, or the next keystroke replaces the range.
	it('ends a live cross-block range when focused, unlike the bare put the caret', () => {
		mounted = mountBreak();
		mounted.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [4], offset: 1 });

		mounted.instance.focus(0);

		expect(mounted.selection.isCrossBlock).toBe(false);
		expect(mounted.el.contains(document.activeElement)).toBe(true);
	});
});

describe('thematic break: keydown levels', () => {
	// The default keys' meanings have their own suite; this level adds only that an edit checks
	// reading mode and navigation does not.
	it.each([
		['source', 1],
		['reading', 0]
	] as const)(
		'in %s mode Enter splits %i time(s) and ArrowDown always traverses',
		(mode, splits) => {
			mounted = mountBreak(mode);

			expect(dispatchKey(mounted.el, { key: 'Enter' }).defaultPrevented).toBe(true);
			dispatchKey(mounted.el, { key: 'ArrowDown' });

			expect(vi.mocked(mounted.blockEdit.splitBlock).mock.calls).toEqual(
				splits ? [[INDEX, displayLength(RAW)]] : []
			);
			expect(mounted.focus.moveFocus).toHaveBeenCalledTimes(1);
			expect(mounted.focus.moveFocus).toHaveBeenCalledWith(INDEX + 1, {
				stickyColumnFrom: 'above'
			});
		}
	);

	it.each([
		['ArrowUp', -1],
		['ArrowDown', 1]
	] as const)('Alt+%s reorders through the kind keymap instead of traversing', (key, dir) => {
		mounted = mountBreak();

		expect(dispatchKey(mounted.el, { key, altKey: true }).defaultPrevented).toBe(true);

		expect(mounted.reorder.nudgeReorderUnit).toHaveBeenCalledWith([INDEX], dir);
		expect(mounted.focus.moveFocus).not.toHaveBeenCalled();
	});

	// A whole-block-focus kind has no editable element to catch undo, so the commands on
	// this handler are the only route to it while the block itself holds focus.
	it('honors an editor-global chord while the block itself holds focus', () => {
		mounted = mountBreak();

		expect(dispatchKey(mounted.el, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(true);

		expect(mounted.history.requestUndo).toHaveBeenCalledTimes(1);
	});

	// `dispatchKeyCommand` declines every command in reading mode, so the block consumes the
	// chord itself, or the browser's undo would fire on a document the user cannot edit.
	it('dead-keys an editor-global chord in reading mode while still consuming it', () => {
		mounted = mountBreak('reading');

		expect(dispatchKey(mounted.el, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(true);

		expect(mounted.history.requestUndo).not.toHaveBeenCalled();
	});
});
