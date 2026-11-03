// @vitest-environment jsdom
// Miss-analysis: every menu Paste row ran in Chromium, which keeps `clipboardData` on a constructed paste event that Firefox empties.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runClipboardAction, type MenuClipboard } from '#lib/components/menu/clipboard-actions.js';
import type { AimedInsert } from '#lib/components/editor-root/focused-surface.js';
import type { ClipboardPayload } from '#lib/editor-actions/system-clipboard.js';

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
describe('a menu Cut or Copy writes what the editor takes, else runs the browser command', () => {
	const savedExec = document.execCommand;
	const savedItem = (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
	let written: string[][];
	let commands: string[];

	beforeEach(() => {
		written = [];
		commands = [];
		(globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {
			constructor(items: Record<string, Blob>) {
				written.push(Object.keys(items));
			}
		};
		Object.defineProperty(navigator, 'clipboard', {
			value: { write: async () => {} },
			configurable: true
		});
		document.execCommand = (command: string) => (commands.push(command), true);
	});
	afterEach(() => {
		(globalThis as { ClipboardItem?: unknown }).ClipboardItem = savedItem;
		document.execCommand = savedExec;
	});

	it('Copy of a range the editor holds writes its text and HTML, with no browser command', async () => {
		const payload: ClipboardPayload = { 'text/plain': 'world', 'text/html': '<p>world</p>' };
		await runClipboardAction(
			'copy',
			menu(null, () => payload)
		);
		expect(written).toEqual([['text/plain', 'text/html']]);
		expect(commands).toEqual([]);
	});

	it('a Cut of a range the browser holds is left to its own command', async () => {
		await runClipboardAction('cut', menu(null));
		expect(written).toEqual([]);
		expect(commands).toEqual(['cut']);
	});
});
