// @vitest-environment jsdom
//
// A composing cell claims no keys. During an IME composition the browser still
// delivers keydown for the keys driving the candidate window — Enter confirms a
// candidate, Tab and the arrows walk it — and those are the same keys a table cell
// binds to structural moves. The cell's handler therefore refuses ahead of everything
// else, before the chord dispatcher and before the navigation plan.
//
// The commit half of composition is pinned in cell-typing-commit (the CST write waits
// for compositionend). This is the keydown half, which nothing pins: the guard is the
// first line of the handler, so a regression is silent right up until an IME user
// confirms a candidate and the table grows a row, or Tab jumps to the next cell
// carrying an unconfirmed composition out of the surface that owns it.
import { describe, it, expect, afterEach } from 'vitest';
import { tick } from 'svelte';
import { mountCell, type MountedCell } from './mount-cell';

let mounted: MountedCell | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

function compose(m: MountedCell): void {
	m.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
}

// The cell's handler awaits its widget intercepts before it can claim anything, so
// `defaultPrevented` is only meaningful once those microtasks have drained. Reading it
// synchronously reports "not claimed" for every key, which is what these tests assert —
// the drain is what keeps them from passing vacuously.
async function press(m: MountedCell, init: KeyboardEventInit): Promise<boolean> {
	const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
	m.el.dispatchEvent(event);
	for (let i = 0; i < 10; i++) await tick();
	return event.defaultPrevented;
}

describe('a composing table cell claims no keys', () => {
	// The navigation vocabulary. Each of these moves the caret out of the cell, which
	// would strand a composition its surface never got to confirm.
	it.each([
		['Tab', { key: 'Tab' }],
		['Shift+Tab', { key: 'Tab', shiftKey: true }],
		['Enter', { key: 'Enter' }],
		['ArrowDown', { key: 'ArrowDown' }]
	])('leaves %s to the composition', async (_label, init) => {
		mounted = mountCell('text');
		mounted.el.focus();
		compose(mounted);

		expect(await press(mounted, init)).toBe(false);
		expect(mounted.tableContext.focusCell).not.toHaveBeenCalled();
		expect(mounted.tableContext.exitDownward).not.toHaveBeenCalled();
	});

	// The structural chords resolve ahead of the navigation plan, so they need their own
	// arm: an IME Enter arriving with a modifier still held must not restructure a table.
	it.each([
		['Mod+Enter', { key: 'Enter', ctrlKey: true }],
		['Mod+Shift+Backspace', { key: 'Backspace', ctrlKey: true, shiftKey: true }],
		['Alt+Shift+ArrowRight', { key: 'ArrowRight', altKey: true, shiftKey: true }]
	])('leaves the %s structural chord unrun', async (_label, init) => {
		mounted = mountCell('text');
		mounted.el.focus();
		compose(mounted);

		expect(await press(mounted, init)).toBe(false);
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
		for (let i = 0; i < 10; i++) await tick();

		expect(await press(mounted, { key: 'Tab' })).toBe(true);
		expect(mounted.tableContext.focusCell).toHaveBeenCalled();
	});
});
