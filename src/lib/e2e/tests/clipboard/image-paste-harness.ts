import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

/**
 * Shared driving for the `onPasteImage` specs. A real image cannot be written to the
 * system clipboard from a spec, so these dispatch a synthetic `paste` carrying a
 * DataTransfer with real `File`s — the same `onPaste` entry a user's Ctrl+V reaches.
 * Caret placement, selection, undo, and typing stay real user actions.
 */

export const PARAGRAPH = 'AB\n';
export const PNG = { name: 'shot.png', type: 'image/png' };

/** One hook answer per image, in clipboard order; the last entry repeats. */
export interface ImagePasteResponse {
	markdown?: string | null;
	reject?: boolean;
	/** Stay pending until `releaseImport`, so a spec can act mid-upload. */
	hold?: boolean;
}

export const setResponses = (page: Page, responses: ImagePasteResponse[]) =>
	page.evaluate((r) => (window as any).__test.imagePaste.setResponses(r), responses);

export const releaseImport = (page: Page) =>
	page.evaluate(() => (window as any).__test.imagePaste.release());

export const getCalls = (page: Page) =>
	page.evaluate(
		() =>
			(window as any).__test.imagePaste.getCalls() as {
				mimeType: string;
				suggestedName: string | null;
				bytes: number;
			}[]
	);

export const parseConverged = (page: Page) =>
	page.evaluate(() => (window as any).__test.parseConverged() as boolean);

/** Open the harness with the host hook installed, responses cleared. */
export async function gotoWithHook(page: Page): Promise<EditorPage> {
	const editor = new EditorPage(page);
	await editor.goto('?imagePaste=on');
	await page.evaluate(() => (window as any).__test.imagePaste.reset());
	return editor;
}

/** Dispatch a paste carrying `files` (plus optional text) at whatever holds focus. */
export async function pasteFiles(
	page: Page,
	files: { name: string; type: string }[],
	text = ''
): Promise<void> {
	await page.evaluate(
		({ files, text }) => {
			const target = document.activeElement as HTMLElement | null;
			if (!target) throw new Error('image paste: nothing focused to paste into');
			const data = new DataTransfer();
			for (const file of files) {
				data.items.add(
					new File([new Uint8Array([137, 80, 78, 71])], file.name, { type: file.type })
				);
			}
			if (text) data.setData('text/plain', text);
			target.dispatchEvent(
				new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
			);
		},
		{ files, text }
	);
}
