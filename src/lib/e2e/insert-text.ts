/**
 * Text that arrives with no key press (a soft keyboard, dictation, an emoji picker), the one way
 * an e2e spec inserts it. Firefox over WebDriver BiDi has no such input and Playwright fakes it
 * with a bare `input` event no browser sends, so there the `beforeinput` comes first and the
 * insert runs only if the page leaves it, as in Chromium's own insert.
 */
import type { Page } from '@playwright/test';
import { isFirefox, isWebKit } from './browser-engine';

export async function insertText(page: Page, text: string): Promise<void> {
	if (!isFirefox(page)) return page.keyboard.insertText(text);
	await page.evaluate((text) => {
		let target = document.activeElement;
		while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement;
		if (!target) throw new Error('nothing is focused to take the text');
		const sel = window.getSelection();
		const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
		const targetRanges = range ? [new StaticRange(range)] : [];
		const before = new InputEvent('beforeinput', {
			bubbles: true,
			cancelable: true,
			composed: true,
			inputType: 'insertText',
			data: text,
			targetRanges
		});
		if (target.dispatchEvent(before)) document.execCommand('insertText', false, text);
	}, text);
}

/** A delete or a break a soft keyboard sends with no key press. */
export type KeylessEdit = 'delete' | 'forwardDelete' | 'insertLineBreak' | 'insertParagraph';

const KEYLESS_INPUT_TYPE: Record<KeylessEdit, string> = {
	delete: 'deleteContentBackward',
	forwardDelete: 'deleteContentForward',
	insertLineBreak: 'insertLineBreak',
	insertParagraph: 'insertParagraph'
};

/** Sends `edit` with no keydown. Chromium and Firefox fire no `beforeinput` for a scripted
 *  command, so there it comes first by hand and the command runs only if the page leaves it. */
export async function keylessEdit(page: Page, edit: KeylessEdit): Promise<void> {
	await page.evaluate(
		({ edit, inputType }) => {
			if (inputType === null) return void document.execCommand(edit);
			let target = document.activeElement;
			while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement;
			if (!target) throw new Error('nothing is focused to take the edit');
			const before = new InputEvent('beforeinput', {
				bubbles: true,
				cancelable: true,
				composed: true,
				inputType
			});
			if (target.dispatchEvent(before)) document.execCommand(edit);
		},
		{ edit, inputType: isWebKit(page) ? null : KEYLESS_INPUT_TYPE[edit] }
	);
}
