import { type CDPSession, type Page } from '@playwright/test';

// The one CDP IME driver, shared by the simulation gestures and the specs: `Input.imeSetComposition`
// fires genuine compositionstart/update events and `Input.insertText` commits through a real
// compositionend. Mid-composition there is no source change, so `compose` settles on the DOM instead.
// Nothing here may hand-fire a CompositionEvent — a synthetic one skips the browser's own window.

export interface ImeDriver {
	/** Set the in-flight composition text and settle on its DOM arrival. */
	compose(text: string): Promise<void>;
	/** Commit the composition through a real compositionend. */
	commit(text: string): Promise<void>;
	/** Abort the in-flight composition, committing no bytes (an empty insert
	 *  ends the composition without writing to the block). */
	abort(): Promise<void>;
}

export async function attachIme(page: Page): Promise<ImeDriver> {
	const cdp: CDPSession = await page.context().newCDPSession(page);
	return {
		async compose(text: string): Promise<void> {
			await cdp.send('Input.imeSetComposition', {
				text,
				selectionStart: text.length,
				selectionEnd: text.length
			});
			await page.waitForFunction(
				(t) => (document.activeElement?.textContent ?? '').includes(t),
				text,
				{ timeout: 2000, polling: 16 }
			);
		},
		async commit(text: string): Promise<void> {
			await cdp.send('Input.insertText', { text });
		},
		async abort(): Promise<void> {
			await cdp.send('Input.insertText', { text: '' });
		}
	};
}
