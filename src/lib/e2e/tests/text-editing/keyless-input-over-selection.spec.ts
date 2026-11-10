import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { insertText, keylessEdit, type KeylessEdit } from '../../insert-text';
import { skipUnlessSupported } from '../../browser-engine';
import { waitForAllImagesLoaded } from '../blocks/image/helpers';

/**
 * Input that arrives with no key while the editor holds a selection goes to the selection, as the
 * key would (`requirements/text-editing/keyless-input-over-selection.md`).
 */

const MODES = ['source', 'live'] as const;
type Mode = (typeof MODES)[number];

const IMAGE = '![x](/test-fixtures/sample.png)';
const HELD_PICTURE = `lead ${IMAGE} tail\n`;
const TWO_BLOCKS = 'first para\n\nsecond para\n\nthird\n';

/** A keyless edit and the key it must match. */
const EDITS: { edit: KeylessEdit; key: string }[] = [
	{ edit: 'delete', key: 'Backspace' },
	{ edit: 'forwardDelete', key: 'Delete' },
	{ edit: 'insertLineBreak', key: 'Shift+Enter' },
	{ edit: 'insertParagraph', key: 'Enter' }
];

async function open(editor: EditorPage, mode: Mode, source: string): Promise<void> {
	await editor.goto(mode === 'live' ? '?presentationMode=live' : '');
	await editor.loadContent(source);
}

async function selectAcrossBlocks(editor: EditorPage, page: Page): Promise<void> {
	await editor.focusBlock(0, 3);
	await page.keyboard.press('Shift+ArrowDown');
	await page.keyboard.press('Shift+ArrowDown');
	await editor.waitForCrossBlock(true);
}

async function holdPicture(editor: EditorPage, page: Page): Promise<void> {
	await waitForAllImagesLoaded(page);
	const box = await page.locator('[data-image-widget]').boundingBox();
	if (!box) throw new Error('the picture has no box');
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await editor.waitForRenderFlush();
}

for (const mode of MODES) {
	test.describe(`over a range across blocks, ${mode} mode`, () => {
		for (const { edit, key } of EDITS) {
			test(`${edit} with no key writes what ${key} writes`, async ({ page }) => {
				const editor = new EditorPage(page);
				await open(editor, mode, TWO_BLOCKS);
				await selectAcrossBlocks(editor, page);
				await page.keyboard.press(key);
				await editor.waitForCrossBlock(false);
				const byKey = await editor.bridge.getSource();
				expect(byKey).not.toBe(TWO_BLOCKS);

				await open(editor, mode, TWO_BLOCKS);
				await selectAcrossBlocks(editor, page);
				await keylessEdit(page, edit);
				await editor.waitForCrossBlock(false);
				await expect.poll(() => editor.bridge.getSource()).toBe(byKey);
			});
		}
	});

	test.describe(`over a picture selected whole, ${mode} mode`, () => {
		for (const text of ['*', '`']) {
			test(`${JSON.stringify(text)} with no key replaces the picture, unpaired`, async ({
				page
			}) => {
				skipUnlessSupported(page, 'insertWithoutSelection');
				const editor = new EditorPage(page);
				await open(editor, mode, HELD_PICTURE);
				await holdPicture(editor, page);
				await insertText(page, text);
				await editor.bridge.waitForSourceEquals(`lead ${text} tail\n`);
			});
		}
	});
}
