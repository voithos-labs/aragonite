// @vitest-environment jsdom
//
// A cell takes no keys while a composition is running. During an IME composition the browser
// still delivers keydown for the keys that drive the candidate window: Enter confirms, Tab and
// the arrows move through it. Those are the keys a table cell binds to structural moves, so the
// handler refuses before the chord dispatcher and the navigation plan. A break here is silent
// until an IME user confirms a candidate and the table grows a row.
import { describe, it, expect, afterEach } from 'vitest';
import { mountCell, settleTicks, type MountedCell } from './mount-cell';

let mounted: MountedCell | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

function compose(m: MountedCell): void {
	m.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
}

// The cell's handler awaits its widget handlers before it can take anything, so reading
// `defaultPrevented` synchronously would report "not taken" for every key, proving nothing.
async function press(m: MountedCell, init: KeyboardEventInit): Promise<boolean> {
	const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
	m.el.dispatchEvent(event);
	await settleTicks();
	return event.defaultPrevented;
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

		expect(await press(mounted, init)).toBe(false);
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
		await settleTicks();

		expect(await press(mounted, { key: 'Tab' })).toBe(true);
		expect(mounted.tableContext.focusCell).toHaveBeenCalled();
	});
});
