import { type CDPSession, type Page } from '@playwright/test';

// Real IME composition surface for the simulation, threaded through the
// SimContext instead of a global. Chromium's `Input.imeSetComposition` fires
// genuine compositionstart/update events against the focused contenteditable,
// and `Input.insertText` commits through a real compositionend — the same
// wiring `tests/ime-composition.spec.ts` pins at the browser level. Mid
// composition there is no source change to settle on, so `compose` settles on
// the composed text arriving in the focused element's DOM; the caller resyncs
// the tracker around the commit.

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
