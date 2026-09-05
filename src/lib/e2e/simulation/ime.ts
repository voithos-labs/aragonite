import { type CDPSession, type Page } from '@playwright/test';
import { isWebKit } from '../browser-engine';

// The one IME driver, shared by the simulation gestures and the specs. Chromium composes through
// CDP, whose `Input.imeSetComposition` / `Input.insertText` fire genuine composition events; WebKit
// exposes no CDP, so its arm hand-fires the sequence at the focused editable — the single exemption
// G4.49 grants, which no spec may copy. Mid-composition there is no source change, so `compose`
// settles on the DOM instead.

export interface ImeDriver {
	/** Set the in-flight composition text and settle on its DOM arrival. */
	compose(text: string): Promise<void>;
	/** Commit the composition through a compositionend carrying the committed data. */
	commit(text: string): Promise<void>;
	/** End the in-flight composition committing no bytes. */
	abort(): Promise<void>;
}

export async function attachIme(page: Page): Promise<ImeDriver> {
	return isWebKit(page) ? handFiredIme(page) : cdpIme(page);
}

// ── Arms ────────────────────────────────────────────────────────────────────

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
 * WebKit's arm, mirroring the unit harness (`test/harness/editable-surface.ts`): the composed run
 * is written into the DOM the way an IME writes it, and the events the editor listens to are fired
 * around that write. What it proves is the commit funnel, not event order — see
 * `requirements/webkit/ime-composition.md`.
 */
function handFiredIme(page: Page): ImeDriver {
	let open = false;

	async function openWindow(): Promise<void> {
		if (open) return;
		open = true;
		await page.evaluate(() => {
			const el = document.activeElement as HTMLElement;
			el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
			// The composing run replaces the selection, as the engine's own window does.
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
		{ timeout: 2000, polling: 16 }
	);
}
