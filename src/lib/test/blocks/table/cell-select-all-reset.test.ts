// @vitest-environment jsdom
//
// The 3-stage Ctrl+A inside a cell (cell text → whole table → whole document) counts presses on
// the shared SelectionState. The counter's keydown reset must stay reachable from every arm the
// cell claims, not from the 'native' plan arm alone, or a key the cell handles leaves the stage
// armed and the next Ctrl+A skips a stage.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { tick } from 'svelte';
import { mountCell } from './mount-cell';

// onKeyDown awaits the widget-reveal intercepts before it reaches the plan.
async function press(el: HTMLElement, init: KeyboardEventInit): Promise<void> {
	el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
	for (let i = 0; i < 10; i++) await tick();
}

let mounted: ReturnType<typeof mountCell>;
// The arrow exit captures a sticky X, which measures the caret; jsdom leaves
// Range rect measurement unimplemented, so it throws rather than reporting zeros.
const originalRangeRects = Range.prototype.getClientRects;
const originalRangeBox = Range.prototype.getBoundingClientRect;
beforeEach(() => {
	Range.prototype.getClientRects = () =>
		({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
});
afterEach(async () => {
	Range.prototype.getClientRects = originalRangeRects;
	Range.prototype.getBoundingClientRect = originalRangeBox;
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
