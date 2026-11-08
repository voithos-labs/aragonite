// jsdom has no clipboard events, no `DataTransfer`, no `execCommand` and no `navigator.clipboard`.
// These stand in for all four, so a unit test drives a copy, a cut, a paste and a menu's clipboard
// rows through the events and calls a browser makes.

import { vi } from 'vitest';
import { OWN_CLIPBOARD_TYPE, ownEntryFor } from '#lib/browser/clipboard.js';

export class StubDataTransfer {
	readonly files: File[] = [];
	readonly items: DataTransferItem[] = [];
	readonly data = new Map<string, string>();
	constructor(payload: Record<string, string> = {}) {
		for (const [type, value] of Object.entries(payload)) this.data.set(type, value);
	}
	get types(): string[] {
		return [...this.data.keys()];
	}
	setData(type: string, value: string): void {
		this.data.set(type, value);
	}
	getData(type: string): string {
		return this.data.get(type) ?? '';
	}
}

class StubClipboardEvent extends Event {
	readonly clipboardData: StubDataTransfer | null;
	constructor(type: string, init: EventInit & { clipboardData?: StubDataTransfer } = {}) {
		super(type, init);
		this.clipboardData = init.clipboardData ?? null;
	}
}

/** A clipboard event of `type` carrying `clipboardData`, sent to `target` as the browser sends it. */
export function dispatchClipboardEvent(
	target: EventTarget,
	type: 'copy' | 'cut' | 'paste',
	clipboardData: StubDataTransfer
): Event {
	const event = new StubClipboardEvent(type, { clipboardData, bubbles: true, cancelable: true });
	target.dispatchEvent(event);
	return event;
}

let commandFires = true;
let lastCommandData: StubDataTransfer | null = null;

/** `fires: false` is WebKit's command over the lone caret under a range the editor holds: it fires
 *  no event. */
export function setCommandFires(fires: boolean): void {
	commandFires = fires;
}

/** The clipboard the last scripted copy or cut wrote into, read once. */
export function takeCommandClipboard(): StubDataTransfer | null {
	const taken = lastCommandData;
	lastCommandData = null;
	return taken;
}

export function installClipboardEvents(): void {
	vi.stubGlobal('DataTransfer', StubDataTransfer);
	vi.stubGlobal('ClipboardEvent', StubClipboardEvent);
	commandFires = true;
	document.execCommand = vi.fn((command: string) => {
		if (command !== 'cut' && command !== 'copy') return false;
		if (!commandFires) return false;
		lastCommandData = new StubDataTransfer();
		dispatchClipboardEvent(document.activeElement ?? document.body, command, lastCommandData);
		return true;
	});
}

// ── The system clipboard ─────────────────────────────────────────────────────

class StubClipboardItem {
	constructor(readonly items: Record<string, Blob>) {}
}

/** What the page's `navigator.clipboard` holds, by type. */
export const systemClipboard = new Map<string, string>();

/** What a paste reads back from the system clipboard: its types, and the editor's own entry the
 *  async write leaves in memory beside its text. */
export function systemClipboardRead(): Record<string, string> {
	const read = Object.fromEntries(systemClipboard);
	const own = ownEntryFor(read['text/plain'] ?? '');
	return own === undefined ? read : { ...read, [OWN_CLIPBOARD_TYPE]: own };
}

/** A `navigator.clipboard` that reads and writes {@link systemClipboard}, as a granted permission
 *  lets a menu's rows do. */
export function installSystemClipboard(): void {
	vi.stubGlobal('ClipboardItem', StubClipboardItem);
	systemClipboard.clear();
	const clipboard = {
		readText: async () => systemClipboard.get('text/plain') ?? '',
		writeText: async (text: string) => {
			systemClipboard.clear();
			systemClipboard.set('text/plain', text);
		},
		write: async ([item]: StubClipboardItem[]) => {
			systemClipboard.clear();
			for (const [type, blob] of Object.entries(item.items)) {
				systemClipboard.set(type, await blob.text());
			}
		}
	};
	Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}
