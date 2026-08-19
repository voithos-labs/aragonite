// @vitest-environment jsdom
//
// The 3-stage Ctrl+A inside a cell (cell text → whole table → whole document) counts presses on
// the shared SelectionState. The counter's keydown reset must stay reachable from every arm the
// cell claims, not from the 'native' plan arm alone, or a key the cell handles leaves the stage
// armed and the next Ctrl+A skips a stage.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { mountCell, settleTicks } from './mount-cell';
import { installTableLayoutStubs } from './mount-table';

// onKeyDown awaits the widget-reveal intercepts before it reaches the plan.
async function press(el: HTMLElement, init: KeyboardEventInit): Promise<void> {
	el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
	await settleTicks();
}

let mounted: ReturnType<typeof mountCell>;
// The arrow exit captures a sticky X, which measures the caret through Range rects.
let restoreLayout: () => void;
beforeAll(() => {
	restoreLayout = installTableLayoutStubs();
	return () => restoreLayout();
});
afterEach(async () => {
	if (mounted) await mounted.dispose();
	document.body.innerHTML = '';
});

describe('the cell resets the select-all stage counter on every key it claims', () => {
	it('Ctrl+A alone advances the counter', async () => {
		mounted = mountCell('text');
		mounted.el.focus();
		await press(mounted.el, { key: 'a', ctrlKey: true });
		expect(mounted.selection.selectAllCount).toBe(1);
	});

	it('Tab to the next cell resets it, so the next Ctrl+A starts at stage one', async () => {
		mounted = mountCell('text');
		mounted.el.focus();
		await press(mounted.el, { key: 'a', ctrlKey: true });
		await press(mounted.el, { key: 'Tab' });
		expect(mounted.selection.selectAllCount).toBe(0);
	});

	it('an arrow exit out of the table resets it, so the count cannot leak into prose', async () => {
		mounted = mountCell('text');
		mounted.el.focus();
		await press(mounted.el, { key: 'a', ctrlKey: true });
		await press(mounted.el, { key: 'ArrowDown' });
		expect(mounted.selection.selectAllCount).toBe(0);
	});

	it('holding Control before the chord does not reset the run', async () => {
		mounted = mountCell('text');
		mounted.el.focus();
		await press(mounted.el, { key: 'a', ctrlKey: true });
		await press(mounted.el, { key: 'Control', ctrlKey: true });
		expect(mounted.selection.selectAllCount).toBe(1);
	});

	it('CapsLock does not change which chord starts the run', async () => {
		mounted = mountCell('text');
		mounted.el.focus();
		await press(mounted.el, { key: 'A', ctrlKey: true });
		expect(mounted.selection.selectAllCount).toBe(1);
	});
});
