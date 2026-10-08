// @vitest-environment jsdom
// A cell takes no keys while an IME composition runs: the browser still delivers the keys that
// drive the candidate window (Enter, Tab, arrows), which a cell binds to structural moves, so the
// handler refuses before the chord dispatcher and the navigation plan.
import { describe, it, expect, afterEach } from 'vitest';
import { mountCell, type MountedCell } from './mount-cell';
import { settleEditor, pressKey } from '$lib/test/harness/settle';

let mounted: MountedCell | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

function compose(m: MountedCell): void {
	m.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
}

describe('a composing table cell claims no keys', () => {
	// The navigation keys. Each moves the caret out of the cell, which would strand a
	// composition the cell never got to confirm.
	it.each([
		['Tab', { key: 'Tab' }],
		['Shift+Tab', { key: 'Tab', shiftKey: true }],
		['Enter', { key: 'Enter' }],
		['ArrowDown', { key: 'ArrowDown' }]
	])('leaves %s to the composition', async (_label, init) => {
		mounted = mountCell('text');
		mounted.el.focus();
		compose(mounted);

		expect((await pressKey(mounted.el, { ...init, isComposing: true })).defaultPrevented).toBe(
			false
		);
		expect(mounted.tableContext.focusCell).not.toHaveBeenCalled();
		expect(mounted.tableContext.exitDownward).not.toHaveBeenCalled();
	});

	// The structural chords resolve before the navigation plan, so they need their own case:
	// an IME Enter arriving with a modifier still held must not restructure a table.
	it.each([
		['Mod+Enter', { key: 'Enter', ctrlKey: true }],
		['Mod+Shift+Backspace', { key: 'Backspace', ctrlKey: true, shiftKey: true }],
		['Alt+Shift+ArrowRight', { key: 'ArrowRight', altKey: true, shiftKey: true }]
	])('leaves the %s structural chord unrun', async (_label, init) => {
		mounted = mountCell('text');
		mounted.el.focus();
		compose(mounted);

		expect((await pressKey(mounted.el, { ...init, isComposing: true })).defaultPrevented).toBe(
			false
		);
		expect(mounted.tableContext.insertRowBelow).not.toHaveBeenCalled();
		expect(mounted.tableContext.deleteRow).not.toHaveBeenCalled();
		expect(mounted.tableContext.insertColumnRight).not.toHaveBeenCalled();
	});

	// The control: the same keys on the same mount, once the composition has ended.
	it('resumes claiming its keys once the composition ends', async () => {
		mounted = mountCell('text');
		mounted.el.focus();
		compose(mounted);
		mounted.el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'x' }));
		await settleEditor();

		expect((await pressKey(mounted.el, { key: 'Tab' })).defaultPrevented).toBe(true);
		expect(mounted.tableContext.focusCell).toHaveBeenCalled();
	});
});
