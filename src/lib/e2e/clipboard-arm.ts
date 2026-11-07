import { type Page } from '@playwright/test';
import { isChromium } from './browser-engine';

/**
 * How a spec's bytes reach the editor's clipboard handlers, the one clipboard every spec and sim
 * goes through (G4.212). Chromium uses the real system clipboard behind the context's permission
 * grants. WebKit's real clipboard is out of reach of the paste keystroke and refuses page reads, and
 * Firefox refuses a write before a user activation, so there `installClipboard` puts an in-page
 * store behind `navigator.clipboard` and the copy events.
 */
export interface ClipboardArm {
	seed(data: ClipboardPayload): Promise<void>;
	/** The clipboard's text of one type, or '' when the clipboard holds none. */
	read(type?: ClipboardType): Promise<string>;
	paste(): Promise<void>;
	waitForContains(expected: string, timeout: number): Promise<void>;
}

export type ClipboardType = 'text/plain' | 'text/html';
/** Plain text, or one string per type for a paste that carries HTML beside the text. */
export type ClipboardPayload = string | Partial<Record<ClipboardType, string>>;

export function createClipboardArm(page: Page): ClipboardArm {
	return isChromium(page) ? systemClipboard(page) : storeClipboard(page);
}

/** Page-side setup before the first navigation; the `page` fixture runs it for every spec. */
export async function installClipboard(page: Page): Promise<void> {
	if (!isChromium(page)) await page.addInitScript(installClipboardStore);
}

/** Make the page's next clipboard read wait until `releaseClipboardRead`, so a spec can swap the
 *  document while a paste is still reading, with no timing in the spec. */
export async function holdClipboardRead(page: Page): Promise<void> {
	await page.evaluate(() => {
		navigator.clipboard.readText = () =>
			new Promise<string>((resolve) => ((window as any).__releaseClipboardRead = resolve));
	});
}

/** Make the page's next clipboard write fail, as a browser refuses one once the page lost focus. */
export async function refuseNextClipboardWrite(page: Page): Promise<void> {
	await page.evaluate(() => {
		const clipboard = navigator.clipboard;
		const real = clipboard.writeText.bind(clipboard);
		clipboard.writeText = () => {
			clipboard.writeText = real;
			return Promise.reject(new DOMException('Document is not focused.', 'NotAllowedError'));
		};
	});
}

/** Resolve the held clipboard read with `text`. */
export async function releaseClipboardRead(page: Page, text: string): Promise<void> {
	await page.evaluate((t) => (window as any).__releaseClipboardRead(t), text);
}

/** Note, at each clipboard read the page makes, whether a right-click menu is still on the page:
 *  Safari draws its Paste prompt over it. `menuAtClipboardRead` reads the last answer. */
export async function watchClipboardRead(page: Page): Promise<void> {
	await page.evaluate(() => {
		const read = navigator.clipboard.readText.bind(navigator.clipboard);
		navigator.clipboard.readText = () => {
			(window as any).__menuAtClipboardRead =
				document.querySelector('.block-menu, .table-action-menu') !== null;
			return read();
		};
	});
}

export function menuAtClipboardRead(page: Page): Promise<boolean | undefined> {
	return page.evaluate(() => (window as any).__menuAtClipboardRead);
}

/** Make every clipboard write the page tries fail, as a webview without clipboard access does;
 *  `refusedClipboardWrites` counts them. */
export async function refuseClipboardWrites(page: Page): Promise<void> {
	await page.evaluate(() => {
		(window as any).__refusedWrites = 0;
		const refused = () => {
			(window as any).__refusedWrites += 1;
			return Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'));
		};
		navigator.clipboard.writeText = refused;
		navigator.clipboard.write = refused;
	});
}

export function refusedClipboardWrites(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__refusedWrites);
}

// ── A paste event carrying data ─────────────────────────────────────────────

export interface PasteInit {
	/** One string per type, as `DataTransfer.setData`. */
	entries?: Partial<Record<ClipboardType, string>>;
	files?: { name: string; type: string }[];
	/** The element the event lands on: the focused one, the body, or the first match of a selector. */
	at?: 'focused' | 'body' | { selector: string };
	/** Drop the live selection just before dispatch, as the browser does past a widget it cannot enter. */
	clearSelection?: boolean;
}

/**
 * Fire a `paste` carrying `entries` and `files` at the editor's real paste entry. The data is set
 * on the event after construction because Firefox drops `clipboardData` from the constructor.
 */
export async function dispatchPaste(page: Page, init: PasteInit): Promise<void> {
	await page.evaluate(({ entries = {}, files = [], at = 'focused', clearSelection = false }) => {
		const target =
			at === 'focused'
				? (document.activeElement as HTMLElement | null)
				: at === 'body'
					? document.body
					: document.querySelector<HTMLElement>(at.selector);
		if (!target) throw new Error('paste: no element to paste into');
		const data = new DataTransfer();
		for (const file of files) {
			data.items.add(new File([new Uint8Array([137, 80, 78, 71])], file.name, { type: file.type }));
		}
		for (const [type, text] of Object.entries(entries)) data.setData(type, text);
		const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(event, 'clipboardData', { value: data });
		if (clearSelection) window.getSelection()?.removeAllRanges();
		target.dispatchEvent(event);
	}, init);
}

// ── Chromium: the system clipboard ──────────────────────────────────────────

function systemClipboard(page: Page): ClipboardArm {
	return {
		async seed(data: ClipboardPayload): Promise<void> {
			if (typeof data === 'string') {
				await page.evaluate((t) => navigator.clipboard.writeText(t), data);
				return;
			}
			await page.evaluate(async (entries) => {
				const blobs = Object.fromEntries(
					Object.entries(entries).map(([type, text]) => [type, new Blob([text], { type })])
				);
				await navigator.clipboard.write([new ClipboardItem(blobs)]);
			}, data);
		},
		read(type: ClipboardType = 'text/plain'): Promise<string> {
			if (type === 'text/plain') return page.evaluate(() => navigator.clipboard.readText());
			return page.evaluate(async (t) => {
				for (const item of await navigator.clipboard.read()) {
					if (item.types.includes(t)) return (await item.getType(t)).text();
				}
				return '';
			}, type);
		},
		async paste(): Promise<void> {
			await page.keyboard.press('ControlOrMeta+v');
		},
		async waitForContains(expected: string, timeout: number): Promise<void> {
			await page.waitForFunction(
				async (e) => (await navigator.clipboard.readText()).includes(e),
				expected,
				{ timeout, polling: 32 }
			);
		}
	};
}

// ── WebKit and Firefox: the in-page store ───────────────────────────────────

type Store = Record<string, string>;

/** Runs in the page: `__e2eClipboard` holds one string per type, and every route reads and
 *  writes it, the editor's `navigator.clipboard` calls and its copy and cut events alike. */
function installClipboardStore(): void {
	const w = window as unknown as { __e2eClipboard: Store };
	w.__e2eClipboard = {};
	const clipboard = {
		readText: async () => w.__e2eClipboard['text/plain'] ?? '',
		writeText: async (text: string) => {
			w.__e2eClipboard = { 'text/plain': String(text) };
		},
		write: async (items: ClipboardItem[]) => {
			const next: Store = {};
			for (const item of items) {
				for (const type of item.types) next[type] = await (await item.getType(type)).text();
			}
			w.__e2eClipboard = next;
		},
		read: async () => {
			const entries = Object.entries(w.__e2eClipboard);
			if (entries.length === 0) return [];
			const blobs = entries.map(([type, text]) => [type, new Blob([text], { type })]);
			return [new ClipboardItem(Object.fromEntries(blobs))];
		}
	};
	Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });

	// Window bubble runs after every handler in the document, so the editor has written first.
	const record = (e: ClipboardEvent) => {
		if (e.defaultPrevented) {
			const data = e.clipboardData;
			w.__e2eClipboard = Object.fromEntries((data?.types ?? []).map((t) => [t, data!.getData(t)]));
			return;
		}
		// An event nobody prevented copies the selection after the listeners, as the browser does.
		const field = document.activeElement;
		const text =
			field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
				? field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)
				: (window.getSelection()?.toString() ?? '');
		w.__e2eClipboard = { 'text/plain': text };
	};
	window.addEventListener('copy', record);
	window.addEventListener('cut', record);
}

function storeClipboard(page: Page): ClipboardArm {
	return {
		async seed(data: ClipboardPayload): Promise<void> {
			const store: Store = typeof data === 'string' ? { 'text/plain': data } : { ...data };
			await page.evaluate((s) => {
				(window as unknown as { __e2eClipboard: Store }).__e2eClipboard = s;
			}, store);
		},
		read(type: ClipboardType = 'text/plain'): Promise<string> {
			return page.evaluate(
				(t) => (window as unknown as { __e2eClipboard?: Store }).__e2eClipboard?.[t] ?? '',
				type
			);
		},
		async paste(): Promise<void> {
			const entries = await page.evaluate(
				() => (window as unknown as { __e2eClipboard?: Store }).__e2eClipboard ?? {}
			);
			await dispatchPaste(page, { entries });
		},
		async waitForContains(expected: string, timeout: number): Promise<void> {
			await page.waitForFunction(
				(e) =>
					(
						(window as unknown as { __e2eClipboard?: Store }).__e2eClipboard?.['text/plain'] ?? ''
					).includes(e),
				expected,
				{ timeout, polling: 32 }
			);
		}
	};
}
