import { test, expect, caretAtEnd, mirror } from './fixtures';
import { BLOCK_VIEWS_SOURCE, LONG_SOURCE } from '../block-views-source';
import type { Page } from '@playwright/test';

// Blocks drawn by the app's own framework components, on the editor the app installed (the
// prebuilt one, for these apps). Requirements: requirements/block-views.md.

test.use({ anyWarning: true });

const framework = (projectName: string) => (projectName.startsWith('vue') ? 'vue' : 'react');

async function expectMirror(page: Page, text: string): Promise<void> {
	await expect.poll(() => mirror(page).textContent()).toBe(text);
}

test.beforeEach(async ({ page }) => {
	await page.goto('/?block-views');
	await expect(page.locator('.editor')).toBeVisible();
});

test('the blocks in the first document mount with the page', async ({ page }, testInfo) => {
	const name = framework(testInfo.project.name);
	await expect(page.locator('.memo-badge')).toHaveText(`memo by ${name}`);
	await expect(page.locator('.memo-text')).toHaveText('%% a memo');
	await expect(page.locator('.label-text')).toHaveText('a label');
	await expect(page.locator('.box-badge')).toHaveText(`box by ${name}`);
	await expect(page.locator('.box .box-children')).toContainText('inside the box');
});

test('a leaf takes typing, and undo takes it back', async ({ page }) => {
	await caretAtEnd(page, '%% a memo');
	await page.keyboard.type(' typed');
	await expectMirror(page, BLOCK_VIEWS_SOURCE.replace('a memo', 'a memo typed'));

	await page.keyboard.press('ControlOrMeta+z');
	await expectMirror(page, BLOCK_VIEWS_SOURCE);
	await expect(page.locator('.memo-text')).toHaveText('%% a memo');
});

test('a leaf keeps every key typed at full speed, in order', async ({ page }) => {
	const sentence = ' the quick brown fox jumps over the lazy dog';
	await caretAtEnd(page, '%% a memo');
	await page.keyboard.type(sentence, { delay: 0 });

	await expectMirror(page, BLOCK_VIEWS_SOURCE.replace('a memo', 'a memo' + sentence));
	await expect(page.locator('.memo-text')).toHaveText('%% a memo' + sentence);
});

test('a click-to-edit block opens on a click, and its edit is one undo step', async ({ page }) => {
	await page.locator('.label-text').click();
	const source = page.locator('.label-source [contenteditable="true"]');
	await expect(source).toBeFocused();
	await page.keyboard.press('End');
	await page.keyboard.type(' edited');
	await expect(source).toHaveText('@@ a label edited');

	await caretAtEnd(page, 'after the blocks');
	const edited = BLOCK_VIEWS_SOURCE.replace('a label', 'a label edited');
	await expectMirror(page, edited);
	await expect(page.locator('.label-text')).toHaveText('a label edited');

	await page.keyboard.press('ControlOrMeta+z');
	await expectMirror(page, BLOCK_VIEWS_SOURCE);
	await expect(page.locator('.label-text')).toHaveText('a label');
});

test('a click-to-edit block previews its source key by key, before anything commits', async ({
	page
}) => {
	await page.locator('.label-text').click();
	const preview = page.locator('.label-preview');
	await expect(preview).toHaveText('a label');
	await page.keyboard.press('End');
	await page.keyboard.type(' xy');
	await expect(preview).toHaveText('a label xy');
	await page.keyboard.press('Backspace');
	await expect(preview).toHaveText('a label x');
	expect(await mirror(page).textContent()).toBe(BLOCK_VIEWS_SOURCE);

	await caretAtEnd(page, 'after the blocks');
	await expect(preview).toHaveCount(0);
	await expect(page.locator('.label-text')).toHaveText('a label x');
});

test('a container holds editable children: typing and Enter land inside it', async ({ page }) => {
	await caretAtEnd(page, 'inside the box');
	await page.keyboard.type(' typed');
	await page.keyboard.press('Enter');
	await page.keyboard.type('second');

	const children = page.locator('.box .box-children');
	await expect(children).toContainText('inside the box typed');
	await expect(children).toContainText('second');
	await expect
		.poll(() => mirror(page).textContent())
		.toContain('%> inside the box typed\n%>\n%> second\n');
	await page.keyboard.press('ControlOrMeta+z');
	await expect(children).not.toContainText('second');
});

test('loading another document from a click swaps the views', async ({ page }) => {
	await page.getByTestId('load').click();

	await expect(page.locator('.memo-text')).toHaveText('%% another memo');
	await expect(page.locator('.label')).toHaveCount(0);
	await expect(page.locator('.box')).toHaveCount(0);
	await caretAtEnd(page, '%% another memo');
	await page.keyboard.type('!');
	await expectMirror(page, '%% another memo!\n\nplain text\n');
});

test('a block scrolled out of the window and back mounts again and takes typing', async ({
	page
}) => {
	await page.getByTestId('load-long').click();
	const memo = page.locator('.memo');
	await expect(memo).toHaveCount(1);
	await page.locator('.editor').hover();

	// Scrolled far enough, the editor unmounts the blocks at the top, destroying their views.
	await expect(async () => {
		await page.mouse.wheel(0, 4000);
		await expect(memo).toHaveCount(0, { timeout: 250 });
	}).toPass();
	await expect(async () => {
		await page.mouse.wheel(0, -4000);
		await expect(memo).toHaveCount(1, { timeout: 250 });
	}).toPass();

	await expect(page.locator('.box .box-children')).toContainText('inside the box');
	await caretAtEnd(page, '%% a memo');
	await page.keyboard.type('!');
	await expectMirror(page, LONG_SOURCE.replace('a memo', 'a memo!'));
});

test('unmounting the editor and mounting it again leaves the blocks working', async ({ page }) => {
	const toggle = page.getByTestId('unmount');
	await toggle.click();
	await expect(page.locator('.editor')).toHaveCount(0);

	await toggle.click();
	await caretAtEnd(page, '%% a memo');
	await page.keyboard.type('!');
	await expectMirror(page, BLOCK_VIEWS_SOURCE.replace('a memo', 'a memo!'));
});
