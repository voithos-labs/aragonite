// @vitest-environment jsdom
// Miss-analysis: every menu Paste row ran in Chromium, which keeps `clipboardData` on a constructed paste event that Firefox empties.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runClipboardAction, type MenuClipboard } from '#lib/components/menu/clipboard-actions.js';
import type { AimedInsert } from '#lib/components/editor-root/focused-surface.js';
import type { ClipboardWrite } from '#lib/browser/clipboard.js';

function seedClipboard(text: string): void {
	Object.defineProperty(navigator, 'clipboard', {
		value: { readText: async () => text },
		configurable: true
	});
}

/** Records which of the block's two entries each paste reached, with the text it was handed. */
function aimed(pasted: string[]): AimedInsert {
	return {
		markdown: async (md) => (pasted.push(`markdown:${md}`), true),
		plainText: async (text) => (pasted.push(`plain:${text}`), true)
	};
}

const menu = (
	pasteTarget: AimedInsert | null,
	take: MenuClipboard['take'] = () => null
): MenuClipboard => ({ take, pasteTarget: () => pasteTarget });

describe('a menu Paste hands the clipboard text to the paste step', () => {
	let events: Event[];
	const record = (e: Event) => void events.push(e);

	beforeEach(() => {
		events = [];
		document.addEventListener('paste', record, true);
	});
	afterEach(() => document.removeEventListener('paste', record, true));

	it('Paste passes the text as Markdown and dispatches no paste event', async () => {
		seedClipboard('**a**\n# b');
		const pasted: string[] = [];
		await runClipboardAction('paste', menu(aimed(pasted)));
		expect(pasted).toEqual(['markdown:**a**\n# b']);
		expect(events).toEqual([]);
	});

	// The block escapes it where it reads Markdown, so the menu passes it untouched.
	it('Paste as plain text passes the text unescaped to the plain-text entry', async () => {
		seedClipboard('**a**\n# b');
		const pasted: string[] = [];
		await runClipboardAction('paste-plain', menu(aimed(pasted)));
		expect(pasted).toEqual(['plain:**a**\n# b']);
		expect(events).toEqual([]);
	});

	it('an empty clipboard pastes nothing', async () => {
		seedClipboard('');
		const pasted: string[] = [];
		await runClipboardAction('paste', menu(aimed(pasted)));
		expect(pasted).toEqual([]);
	});
});

// Miss-analysis: every menu Copy ran in Chromium, whose copy command fires over a lone caret;
// WebKit's copies nothing when the editor paints the range and only a caret stands under it.
describe("a menu Cut or Copy runs the browser's command, and writes itself only when no copy step took it", () => {
	const savedExec = document.execCommand;
	const savedItem = (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
	let written: string[][];
	let commands: string[];
	let taken: number;

	// `fires`: the command dispatches its event, and the editor's copy step takes it.
	function browserCommand(fires: boolean): void {
		document.execCommand = (command: string) => {
			commands.push(command);
			if (!fires) return false;
			const event = new Event(command, { cancelable: true });
			document.body.addEventListener(command, (e) => e.preventDefault(), { once: true });
			document.body.dispatchEvent(event);
			return true;
		};
	}

	beforeEach(() => {
		written = [];
		commands = [];
		taken = 0;
		(globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {
			constructor(items: Record<string, Blob>) {
				written.push(Object.keys(items));
			}
		};
		Object.defineProperty(navigator, 'clipboard', {
			value: { write: async () => {} },
			configurable: true
		});
		browserCommand(false);
	});
	afterEach(() => {
		(globalThis as { ClipboardItem?: unknown }).ClipboardItem = savedItem;
		document.execCommand = savedExec;
	});

	// The editor's own entry rides along, and the async write still carries standard types alone:
	// one type of the editor's own refuses the whole write on every engine.
	const payload: ClipboardWrite = { text: 'world', html: '<p>world</p>', own: 'entry' };
	const taking = (removed: string[]) => () => {
		taken += 1;
		return { write: payload, remove: async () => void removed.push('removed') };
	};

	it("Copy the editor's copy step takes writes nothing more, as in a frame with no clipboard permission", async () => {
		browserCommand(true);
		const removed: string[] = [];
		await runClipboardAction('copy', menu(null, taking(removed)));
		expect(commands).toEqual(['copy']);
		expect(taken).toBe(0);
		expect(written).toEqual([]);
	});

	it('Copy whose command fires nothing writes the range the editor holds, text and HTML', async () => {
		const removed: string[] = [];
		await runClipboardAction('copy', menu(null, taking(removed)));
		expect(commands).toEqual(['copy']);
		expect(written).toEqual([['text/plain', 'text/html']]);
		expect(removed).toEqual([]);
	});

	it('Cut whose command fires nothing removes the range once the write lands', async () => {
		const removed: string[] = [];
		await runClipboardAction('cut', menu(null, taking(removed)));
		expect(written).toEqual([['text/plain', 'text/html']]);
		expect(removed).toEqual(['removed']);
	});

	// Miss-analysis: every menu Cut row ran with the clipboard granted, so none saw a refused write
	// remove the range anyway.
	it('Cut whose write the browser refuses keeps the range', async () => {
		Object.defineProperty(navigator, 'clipboard', {
			value: { write: async () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
			configurable: true
		});
		const removed: string[] = [];
		await runClipboardAction('cut', menu(null, taking(removed)));
		expect(removed).toEqual([]);
	});

	it('Cut with no range the editor holds is the command alone', async () => {
		await runClipboardAction('cut', menu(null));
		expect(commands).toEqual(['cut']);
		expect(written).toEqual([]);
	});
});
