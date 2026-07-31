// @vitest-environment jsdom
//
// The right-click menu's clipboard door — the cell's SECOND paste entry path, reached with no
// ClipboardEvent and no focus, so nothing the event door gets for free applies: the menu click
// already moved focus off the cell, and the clipboard has to be ASKED rather than read off an
// event. e2e drives the happy paths through a real menu (`right-click-clipboard.spec.ts`) and
// the cut arm is pinned in cell-write-escape; what only a unit mount can reach is a clipboard
// that says no, and what the door does before it mutates.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { tick } from 'svelte';
import { registerBuiltInBlocks } from '$lib/components/built-in-blocks';
import { mountCell, type MountedCell } from './mount-cell';

// The cell's paste surface is a built-in registration; without it the dispatcher falls
// through to the prose default hook and the cell's own normalization never runs.
registerBuiltInBlocks();

let mounted: MountedCell | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

/** jsdom ships no clipboard; each test installs the answer it means to test. */
function installClipboard(readText: () => Promise<string>): void {
	Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true });
}

/** The raw the door committed, or null if it committed nothing. */
function committedRaw(): string | null {
	const calls = vi.mocked(mounted!.blockEdit.updateBlockContent).mock.calls;
	return calls.length === 0 ? null : calls[calls.length - 1][1];
}

describe('a menu paste asks the clipboard and lands through the cell’s paste surface', () => {
	it('inserts what it read, collapsing the newlines the row cannot hold', async () => {
		// The positive control for the refusal below, and the routing assertion in one: a raw
		// splice of the clipboard text would leave the newline in, and a `\n` in `cell.raw`
		// reparses the row short a column.
		installClipboard(async () => 'x\ny');
		mounted = mountCell('one');

		await mounted.ref().applyMenuClipboard!('paste', { start: 3, end: 3 });
		await tick();

		expect(committedRaw()).toBe('onex y');
	});

	it('degrades to a no-op when the clipboard refuses to be read', async () => {
		// Fired un-awaited from the menu's onclick, so a denied read that escapes surfaces as
		// an unhandled rejection — and the cell must be left exactly as it was.
		installClipboard(async () => {
			throw new DOMException('Read permission denied.', 'NotAllowedError');
		});
		mounted = mountCell('one');

		await expect(
			mounted.ref().applyMenuClipboard!('paste', { start: 3, end: 3 })
		).resolves.toBeUndefined();

		expect(committedRaw()).toBeNull();
	});
});

describe('the door restores the focus the menu click took away', () => {
	it('focuses the cell before copying, so there is a range to copy', async () => {
		// Clicking a menu item blurs the cell; `execCommand('copy')` reads the live selection,
		// so a copy issued against an unfocused cell writes an empty clipboard.
		const execCommand = vi.fn(() => true);
		document.execCommand = execCommand;
		mounted = mountCell('one');
		mounted.el.focus();
		mounted.el.blur(); // what the menu click does

		await mounted.ref().applyMenuClipboard!('copy', { start: 0, end: 3 });

		expect(document.activeElement).toBe(mounted.el);
		expect(execCommand).toHaveBeenCalledWith('copy');
	});
});
