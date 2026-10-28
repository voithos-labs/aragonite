import { type CDPSession, type Page } from '@playwright/test';
import { isChromium } from '../browser-engine';

// The one IME driver, shared by the simulation gestures and the specs. Chromium composes through
// CDP's `Input.imeSetComposition` and `Input.insertText`, which fire real composition events;
// WebKit and Firefox have no CDP, so their branch fires the sequence by hand, the one exception no
// spec may copy (G4.49). The source does not change mid-composition, so `compose` waits on the DOM.

export interface ImeDriver {
	/** Sets the text being composed and waits for it to appear in the DOM. */
	compose(text: string): Promise<void>;
	/** Commits the composition through a compositionend carrying the committed data. */
	commit(text: string): Promise<void>;
	/** Ends the composition in progress, writing no bytes. */
	abort(): Promise<void>;
	/** Presses a key inside the open composition, as a keystroke the IME takes for itself. */
	press(key: string): Promise<void>;
	/** Sends the keydown that opens a composition, before it starts: code 229 and `isComposing:
	 *  false`, named `Process` (Windows) or the letter pressed (macOS). */
	openingKey(key: string): Promise<void>;
}

export async function attachIme(page: Page): Promise<ImeDriver> {
	return isChromium(page) ? cdpIme(page) : handFiredIme(page);
}

// ── The two branches ────────────────────────────────────────────────────────

async function cdpIme(page: Page): Promise<ImeDriver> {
	const cdp: CDPSession = await page.context().newCDPSession(page);
	return {
		async compose(text: string): Promise<void> {
			await cdp.send('Input.imeSetComposition', {
				text,
				selectionStart: text.length,
				selectionEnd: text.length
			});
			await settleOnComposedText(page, text);
		},
		async commit(text: string): Promise<void> {
			await cdp.send('Input.insertText', { text });
		},
		async abort(): Promise<void> {
			await cdp.send('Input.insertText', { text: '' });
		},
		async press(key: string): Promise<void> {
			// Chromium's keydown inside a CDP composition already says `isComposing: true`.
			await page.keyboard.press(key);
		},
		async openingKey(key: string): Promise<void> {
			// No text, so Chromium types nothing for it, as for the IME's own key.
			for (const type of ['rawKeyDown', 'keyUp'] as const) {
				await cdp.send('Input.dispatchKeyEvent', {
					type,
					key,
					windowsVirtualKeyCode: 229,
					nativeVirtualKeyCode: 229
				});
			}
		}
	};
}

/** The composed text's place: the caret's own text node, or one made for it beside an element. */
interface ImeRun {
	node: Text;
	start: number;
	length: number;
	created: boolean;
}

// Far more turns than the longest chain of ticks the editor awaits inside a listener.
const MICROTASK_CHECKPOINT_TURNS = 1000;

/**
 * The branch for WebKit and Firefox writes the composed text into the DOM the way an IME does and
 * fires the editor's events around it: it proves the commit path runs, not the event order.
 */
function handFiredIme(page: Page): ImeDriver {
	let open = false;

	async function openWindow(): Promise<void> {
		if (open) return;
		open = true;
		await page.evaluate(async (turns) => {
			const el = document.activeElement as HTMLElement;
			el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
			// The browser drains the microtask queue before it writes, so the editor's listener work
			// lands first; a long run of awaits does the same with no task able to run in between.
			for (let i = 0; i < turns; i++) await Promise.resolve();
			// The composed text replaces the selection, as the browser's own composition does, and
			// grows inside the text node the caret is in, so a caret check sees it where the IME puts it.
			const range = window.getSelection()!.getRangeAt(0);
			range.deleteContents();
			let node = range.startContainer;
			const created = !(node instanceof Text);
			if (created) {
				node = document.createTextNode('');
				range.insertNode(node);
			}
			const run: ImeRun = {
				node: node as Text,
				start: created ? 0 : range.startOffset,
				length: 0,
				created
			};
			(window as any).__imeRun = run;
		}, MICROTASK_CHECKPOINT_TURNS);
	}

	async function write(text: string, end: boolean): Promise<void> {
		await page.evaluate(
			({ text, end }) => {
				const el = document.activeElement as HTMLElement;
				const run = (window as any).__imeRun as ImeRun;
				run.node.replaceData(run.start, run.length, text);
				run.length = text.length;
				const range = document.createRange();
				range.setStart(run.node, run.start + run.length);
				range.collapse(true);
				const selection = window.getSelection()!;
				selection.removeAllRanges();
				selection.addRange(range);
				el.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: text }));
				for (const type of ['beforeinput', 'input']) {
					el.dispatchEvent(
						new InputEvent(type, {
							bubbles: true,
							cancelable: type === 'beforeinput',
							inputType: 'insertCompositionText',
							data: text,
							isComposing: true
						})
					);
				}
				if (end)
					el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
			},
			{ text, end }
		);
	}

	return {
		async openingKey(key: string): Promise<void> {
			await page.evaluate((key) => {
				const el = document.activeElement as HTMLElement;
				for (const type of ['keydown', 'keyup']) {
					const e = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
					Object.defineProperty(e, 'keyCode', { value: 229 });
					el.dispatchEvent(e);
				}
			}, key);
		},
		async compose(text: string): Promise<void> {
			await openWindow();
			await write(text, false);
			await settleOnComposedText(page, text);
		},
		async commit(text: string): Promise<void> {
			await openWindow();
			await write(text, true);
			open = false;
		},
		async abort(): Promise<void> {
			if (!open) return;
			await page.evaluate(() => {
				const el = document.activeElement as HTMLElement;
				const run = (window as any).__imeRun as ImeRun;
				if (run.created) run.node.remove();
				else run.node.deleteData(run.start, run.length);
				el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
			});
			open = false;
		},
		async press(key: string): Promise<void> {
			if (!open) throw new Error('ime.press needs an open composition; press a plain key instead');
			// The IME keeps the key, so it fires no input and changes nothing the commit won't overwrite.
			await page.evaluate((key) => {
				const el = document.activeElement as HTMLElement;
				for (const type of ['keydown', 'keyup']) {
					el.dispatchEvent(
						new KeyboardEvent(type, { key, bubbles: true, cancelable: true, isComposing: true })
					);
				}
			}, key);
		}
	};
}

function settleOnComposedText(page: Page, text: string): Promise<unknown> {
	return page.waitForFunction(
		(t) => (document.activeElement?.textContent ?? '').includes(t),
		text,
		{ timeout: 5000, polling: 16 }
	);
}
