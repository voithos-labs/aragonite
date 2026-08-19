// @vitest-environment jsdom
//
// ThematicBreakBlock is the reference whole-block-focus kind (docs/design/editor.md § 8): the
// block IS its own focus target. The key TAIL's semantics belong to `whole-block-keys.test.ts`
// and the caret-adjacent Backspace fallback to `block-edit-core.test.ts`; what only a mount can
// show is this component's own wiring — the focus surface it publishes, and the three-tier
// keydown order (editor-global chord → kind keymap → tail) with its local reading gate.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { displayLength } from '$lib/core/lines';
import { WHOLE_BLOCK_INPUT_ATTR } from '$lib/editor-actions/whole-block-focus-surface';
import {
	BREAK_INDEX as INDEX,
	BREAK_RAW as RAW,
	mountBreak,
	type MountedBreak
} from './mount-break';

function press(el: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
	const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
	el.dispatchEvent(event);
	return event;
}

let mounted: MountedBreak;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	document.body.innerHTML = '';
});

describe('thematic break — the whole-block focus surface', () => {
	// Miss-analysis: nothing read the two tabindexes together, so the block shipped with two tab
	// stops and a Shift+Tab that parked on the separator instead of leaving.
	it('renders a separator and declares itself non-editable, with the host as its one tab stop', () => {
		mounted = mountBreak();
		const rule = mounted.el.querySelector('.thematic-break-rule') as HTMLElement;
		const host = mounted.el.querySelector(`[${WHOLE_BLOCK_INPUT_ATTR}]`) as HTMLElement;

		expect(rule.getAttribute('role')).toBe('separator');
		expect(rule.tabIndex).toBe(-1);
		expect(host.tabIndex).toBe(0);
		expect(rule.querySelector('hr')).not.toBeNull();
		expect(mounted.instance.editable).toBe(false);
		expect(mounted.instance.focusable).toBe(true);
	});

	// Where the park LANDS is pinned finer in thematic-break-input-proxy (activeElement IS the host).
	it('reports no cursor offset until the caret is parked', () => {
		mounted = mountBreak();
		expect(mounted.instance.getCursorOffset()).toBeNull();
	});

	// `focus` owes the range-ending `parkCaret` skips: a whole-block landing seats no DOM
	// caret, so a live cross-block range would survive it and the next keystroke type-replaces.
	it('ends a live cross-block range when focused, unlike the bare park', () => {
		mounted = mountBreak();
		mounted.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [4], offset: 1 });

		mounted.instance.focus(0);

		expect(mounted.selection.isCrossBlock).toBe(false);
		expect(mounted.el.contains(document.activeElement)).toBe(true);
	});
});

describe('thematic break — keydown tiers', () => {
	// Two rows, not five: the tail's own suite owns every branch's semantics, and the only
	// distinction this layer adds is that the edit arm gates on reading mode while nav never does.
	it.each([
		['source', 1],
		['reading', 0]
	] as const)(
		'in %s mode Enter splits %i time(s) and ArrowDown always traverses',
		(mode, splits) => {
			mounted = mountBreak(mode);

			expect(press(mounted.el, { key: 'Enter' }).defaultPrevented).toBe(true);
			press(mounted.el, { key: 'ArrowDown' });

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

		expect(press(mounted.el, { key, altKey: true }).defaultPrevented).toBe(true);

		expect(mounted.reorder.nudgeReorderUnit).toHaveBeenCalledWith([INDEX], dir);
		expect(mounted.focus.moveFocus).not.toHaveBeenCalled();
	});

	// A whole-block-focus kind has no editable surface to catch undo, so the command tiers on
	// this handler are the only route to it while the block itself holds focus.
	it('honors an editor-global chord while the block itself holds focus', () => {
		mounted = mountBreak();

		expect(press(mounted.el, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(true);

		expect(mounted.history.requestUndo).toHaveBeenCalledTimes(1);
	});

	// What the local global-chord arm is FOR: `dispatchKeyCommand` dead-keys the whole vocabulary
	// in reading mode by declining, which would leave the chord unconsumed and the browser's
	// native undo free to fire on a document the reader cannot edit.
	it('dead-keys an editor-global chord in reading mode while still consuming it', () => {
		mounted = mountBreak('reading');

		expect(press(mounted.el, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(true);

		expect(mounted.history.requestUndo).not.toHaveBeenCalled();
	});
});
