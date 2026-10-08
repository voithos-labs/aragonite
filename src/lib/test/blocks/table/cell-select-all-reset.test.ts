// @vitest-environment jsdom
// The two-press Ctrl+A inside a cell counts keypresses on the shared `SelectionState`, so every
// key the cell handles must reset the count, or the next Ctrl+A skips a stage.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { mountCell } from './mount-cell';
import { installTableLayoutStubs } from './mount-table';
import { pressKey } from '#lib/test/harness/settle.js';

let mounted: ReturnType<typeof mountCell>;
// The arrow exit captures a sticky column, which measures the caret through Range rects.
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
		await pressKey(mounted.el, { key: 'a', ctrlKey: true });
		expect(mounted.selection.selectAllCount).toBe(1);
	});

	it('Tab to the next cell resets it, so the next Ctrl+A starts at stage one', async () => {
		mounted = mountCell('text');
		mounted.el.focus();
		await pressKey(mounted.el, { key: 'a', ctrlKey: true });
		await pressKey(mounted.el, { key: 'Tab' });
		expect(mounted.selection.selectAllCount).toBe(0);
	});

	it('an arrow exit out of the table resets it, so the count cannot leak into prose', async () => {
		mounted = mountCell('text');
		mounted.el.focus();
		await pressKey(mounted.el, { key: 'a', ctrlKey: true });
		await pressKey(mounted.el, { key: 'ArrowDown' });
		expect(mounted.selection.selectAllCount).toBe(0);
	});

	it('holding Control before the chord does not reset the run', async () => {
		mounted = mountCell('text');
		mounted.el.focus();
		await pressKey(mounted.el, { key: 'a', ctrlKey: true });
		await pressKey(mounted.el, { key: 'Control', ctrlKey: true });
		expect(mounted.selection.selectAllCount).toBe(1);
	});

	it('CapsLock does not change which chord starts the run', async () => {
		mounted = mountCell('text');
		mounted.el.focus();
		await pressKey(mounted.el, { key: 'A', ctrlKey: true });
		expect(mounted.selection.selectAllCount).toBe(1);
	});
});
