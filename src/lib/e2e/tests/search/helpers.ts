import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// Shared find/replace bar locators and open helpers for the search e2e specs.

export const findInput = (page: Page) => page.getByRole('textbox', { name: 'Find' });
export const replaceInput = (page: Page) => page.getByRole('textbox', { name: 'Replace' });
export const count = (page: Page) => page.locator('.search-count');
export const overlays = (page: Page) => page.locator('.match-overlay');
export const activeOverlays = (page: Page) => page.locator('.match-overlay-active');

// Ctrl+F / Ctrl+H route through a document-level handler, so the editor only needs
// focus somewhere on the page. Click block 0 first, then open; the bar auto-focuses
// the find input, so typing lands there.
export async function openFind(editor: EditorPage): Promise<void> {
	await editor.clickBlock(0);
	await editor.page.keyboard.press('ControlOrMeta+f');
	await findInput(editor.page).waitFor({ state: 'visible' });
}

export async function openReplace(editor: EditorPage): Promise<void> {
	await editor.clickBlock(0);
	await editor.page.keyboard.press('ControlOrMeta+h');
	await replaceInput(editor.page).waitFor({ state: 'visible' });
}

// Type into the (already-focused) find input character by character.
export async function typeQuery(editor: EditorPage, query: string): Promise<void> {
	await editor.page.keyboard.type(query);
}
