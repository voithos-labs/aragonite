import { type CDPSession, type Page } from '@playwright/test';
import { isWebKit } from '../browser-engine';

// The one IME driver, shared by the simulation gestures and the specs. Chromium composes through
// CDP's `Input.imeSetComposition` and `Input.insertText`, which fire real composition events;
// WebKit has no CDP, so its branch fires the sequence by hand, the one exception no spec may copy
// (G4.49). The source does not change mid-composition, so `compose` waits on the DOM.

export interface ImeDriver {
	/** Sets the text being composed and waits for it to appear in the DOM. */
	compose(text: string): Promise<void>;
	/** Commits the composition through a compositionend carrying the committed data. */
	commit(text: string): Promise<void>;
	/** Ends the composition in progress, writing no bytes. */
	abort(): Promise<void>;
}

export async function attachIme(page: Page): Promise<ImeDriver> {
	return isWebKit(page) ? handFiredIme(page) : cdpIme(page);
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
		}
	};
}

/**
 * WebKit's branch writes the composed text into the DOM the way an IME does and fires the editor's
 * events around it: it proves the commit path runs, not the event order.
 */
function handFiredIme(page: Page): ImeDriver {
	let open = false;

	async function openWindow(): Promise<void> {
		if (open) return;
		open = true;
		await page.evaluate(() => {
			const el = document.activeElement as HTMLElement;
			el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
			// The composed text replaces the selection, as the browser's own composition does.
			const range = window.getSelection()!.getRangeAt(0);
			range.deleteContents();
			const run = document.createTextNode('');
			range.insertNode(run);
			(window as any).__imeRun = run;
		});
	}

	async function write(text: string, end: boolean): Promise<void> {
		await page.evaluate(
			({ text, end }) => {
				const el = document.activeElement as HTMLElement;
				const run = (window as any).__imeRun as Text;
				run.data = text;
				const range = document.createRange();
				range.setStart(run, text.length);
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
				((window as any).__imeRun as Text).remove();
				el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
			});
			open = false;
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
