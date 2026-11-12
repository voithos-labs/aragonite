// @vitest-environment jsdom
// The right-click menu's clipboard handling, the cell's second way into a paste: the menu click
// has moved focus off the cell and there is no ClipboardEvent, so the clipboard has to be asked
// and its text handed to the editor's paste entry. The e2e spec covers the happy paths; a unit
// mount reaches a clipboard that refuses, and what happens before anything is written.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mountCell, type MountedCell } from './mount-cell';

let mounted: MountedCell | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

/** jsdom has no clipboard, so each test installs the answer it means to test. */
function installClipboard(readText: () => Promise<string>): void {
	Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true });
}

/** The raw that was committed, or null if nothing was. */
function committedRaw(): string | null {
	const calls = vi.mocked(mounted!.blockEdit.updateBlockContent).mock.calls;
	return calls.length === 0 ? null : calls[calls.length - 1][1];
}

describe('a menu paste asks the clipboard and hands it to the editor’s paste entry', () => {
	it('pastes what it read over the selection the menu opened on', async () => {
		// Also the control for the refusal below.
		installClipboard(async () => 'x\ny');
		const pasted: unknown[] = [];
		const pasteTarget = () => async (clip: { text: string }) => {
			pasted.push({ text: clip.text, over: mounted!.ref().getSelectionOffsets?.() });
			return true;
		};
		mounted = mountCell('one', { menuClipboard: { take: () => null, pasteTarget } });

		await mounted.ref().applyMenuClipboard!('paste', { start: 1, end: 3 });

		expect(pasted).toEqual([{ text: 'x\ny', over: { start: 1, end: 3 } }]);
		expect(committedRaw()).toBeNull();
	});

	it('degrades to a no-op when the clipboard refuses to be read', async () => {
		// Started without being awaited from the menu's `onclick`, so a denied read that escapes
		// shows up as an unhandled rejection, and the cell must be left exactly as it was.
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

describe('the entry point restores the focus the menu click took away', () => {
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
