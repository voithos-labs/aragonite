import { test, expect, caretAtEnd, mirror } from './fixtures';
import { BLOCK_VIEWS_SOURCE, LONG_SOURCE } from '../block-views-source';
import type { Page } from '@playwright/test';

// A die the app's framework component draws whole (`surface: 'none'`), publishing its members
// through `useBlockHandle`, on the `?block-views` page. Requirements: requirements/hand-built.md.

test.use({ anyWarning: true });

const roll = (page: Page) => page.locator('.dice-roll');
const activeText = (page: Page) => page.evaluate(() => document.activeElement?.textContent ?? '');

async function expectMirror(page: Page, text: string): Promise<void> {
	await expect.poll(() => mirror(page).textContent()).toBe(text);
}

async function focusDieFromAbove(page: Page): Promise<void> {
	await caretAtEnd(page, 'after the blocks');
	await page.keyboard.press('ArrowDown');
	await expect(roll(page)).toBeFocused();
}

test.beforeEach(async ({ page }) => {
	await page.goto('/?block-views');
	await expect(roll(page)).toHaveText('d6: roll me');
});

test('arrows land on the die’s button and leave it, both ways', async ({ page }) => {
	await focusDieFromAbove(page);
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => activeText(page)).toBe('the end');

	await page.keyboard.press('ArrowUp');
	await expect(roll(page)).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await expect.poll(() => activeText(page)).toBe('after the blocks');
	expect(await mirror(page).textContent()).toBe(BLOCK_VIEWS_SOURCE);
});

test('Enter and Space are the die’s own, and roll it without touching the bytes', async ({
	page
}) => {
	await focusDieFromAbove(page);
	await page.keyboard.press('Enter');
	await expect(roll(page)).toHaveText('d6: 1');
	await page.keyboard.press('Space');
	await expect(roll(page)).toHaveText('d6: 2');
	await expect(roll(page)).toBeFocused();
	expect(await mirror(page).textContent()).toBe(BLOCK_VIEWS_SOURCE);
});

test('focus goes out and comes back to the die, which keeps what it rolled', async ({ page }) => {
	await roll(page).click();
	await expect(roll(page)).toHaveText('d6: 1');
	await caretAtEnd(page, 'the end');
	await expect.poll(() => activeText(page)).toBe('the end');

	await page.keyboard.press('ArrowUp');
	await expect(roll(page)).toBeFocused();
	await expect(roll(page)).toHaveText('d6: 1');
});

test('Ctrl+Z at the focused die undoes the edit before it', async ({ page }) => {
	await caretAtEnd(page, 'the end');
	await page.keyboard.type('!');
	await expectMirror(page, BLOCK_VIEWS_SOURCE.replace('the end', 'the end!'));

	await page.keyboard.press('ArrowUp');
	await expect(roll(page)).toBeFocused();
	await page.keyboard.press('ControlOrMeta+z');
	await expectMirror(page, BLOCK_VIEWS_SOURCE);
});

test('a die scrolled out of the window and back takes the caret again', async ({ page }) => {
	await page.getByTestId('load-long').click();
	await expect(roll(page)).toHaveCount(1);
	await page.locator('.editor').hover();

	await expect(async () => {
		await page.mouse.wheel(0, 4000);
		await expect(roll(page)).toHaveCount(0, { timeout: 250 });
	}).toPass();
	await expect(async () => {
		await page.mouse.wheel(0, -4000);
		await expect(roll(page)).toHaveCount(1, { timeout: 250 });
	}).toPass();

	await focusDieFromAbove(page);
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => activeText(page)).toBe('the end');
	expect(await mirror(page).textContent()).toBe(LONG_SOURCE);
});

test('a die whose component throws shows its source, reported to the editor alone', async ({
	page,
	problems
}, testInfo) => {
	await caretAtEnd(page, 'the end');
	await page.keyboard.press('Enter');
	// Typed whole, since `!! ` alone already turns the line into a die.
	await page.keyboard.type('!!boom');
	await page.keyboard.press('Home');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.type(' ');

	await expect.poll(() => mirror(page).textContent()).toContain('the end\n\n!! boom');
	await expect(page.locator('.editor')).toContainText('!! boom');
	await expect(roll(page)).toHaveCount(1);
	// React 18 logs every throw it rethrows, and has no option to stop it.
	if (testInfo.project.name === 'react18') {
		const logged = problems.findIndex((problem) => problem.startsWith('Error: the die went boom'));
		if (logged >= 0) problems.splice(logged, 1);
	}
});
