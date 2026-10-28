import { test, expect, caretAtEnd, mirror } from './fixtures';
import { BLOCK_VIEWS_SOURCE } from '../block-views-source';
import type { Page } from '@playwright/test';

// A block focused whole, with a textarea of its own, drawn by the app's framework component on the
// `?block-views` page. Requirements: requirements/own-surface.md.

test.use({ anyWarning: true });

/** Focus sits on the note's editing host, inside the note. */
const noteFocusedWhole = (page: Page) =>
	page.evaluate(() => {
		const active = document.activeElement;
		return !!active?.closest('.note') && active.hasAttribute('data-whole-block-input');
	});

const activeText = (page: Page) => page.evaluate(() => document.activeElement?.textContent ?? '');

async function expectMirror(page: Page, text: string): Promise<void> {
	await expect.poll(() => mirror(page).textContent()).toBe(text);
}

async function focusNoteFromAbove(page: Page): Promise<void> {
	await caretAtEnd(page, ' chip');
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => noteFocusedWhole(page)).toBe(true);
}

test.beforeEach(async ({ page }) => {
	await page.goto('/?block-views');
	await expect(page.locator('.note-text')).toHaveText('hello note\n');
});

test('arrows stop on the note whole and leave it, both ways', async ({ page }) => {
	await focusNoteFromAbove(page);
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => activeText(page)).toBe('after the blocks');

	await page.keyboard.press('ArrowUp');
	await expect.poll(() => noteFocusedWhole(page)).toBe(true);
	await page.keyboard.press('ArrowUp');
	await expect.poll(() => activeText(page)).toContain(' chip');
});

test('Shift+Tab from below lands on the note’s editing host, and Tab goes on from it', async ({
	page
}) => {
	await caretAtEnd(page, 'after the blocks');
	await page.keyboard.press('Shift+Tab');
	await expect.poll(() => noteFocusedWhole(page)).toBe(true);

	await page.keyboard.press('Tab');
	await expect.poll(() => activeText(page)).toBe('after the blocks');
	expect(await mirror(page).textContent()).toBe(BLOCK_VIEWS_SOURCE);
});

test('a double click opens the textarea, and leaving it commits one undo step', async ({
	page
}) => {
	await page.locator('.note-text').dblclick();
	const box = page.locator('.note-source');
	await expect(box).toBeFocused();
	await page.keyboard.press('ControlOrMeta+End');
	const sentence = ' and the quick brown fox jumps over the lazy dog';
	await page.keyboard.type(sentence, { delay: 0 });
	await expect(box).toHaveValue('hello note' + sentence);
	expect(await mirror(page).textContent()).toBe(BLOCK_VIEWS_SOURCE);

	await caretAtEnd(page, 'after the blocks');
	await expectMirror(page, BLOCK_VIEWS_SOURCE.replace('hello note', 'hello note' + sentence));
	await expect(page.locator('.note-text')).toHaveText(`hello note${sentence}\n`);

	await page.keyboard.press('ControlOrMeta+z');
	await expectMirror(page, BLOCK_VIEWS_SOURCE);
});

test('the kind’s command opens the textarea at the focused note', async ({ page }) => {
	await focusNoteFromAbove(page);
	await page.keyboard.press('ControlOrMeta+m');
	await expect(page.locator('.note-source')).toBeFocused();
});

test('a character typed at the focused note lands in a new paragraph below', async ({ page }) => {
	await focusNoteFromAbove(page);
	await page.keyboard.type('x');
	await expectMirror(page, BLOCK_VIEWS_SOURCE.replace('```\n\nafter', '```\n\nx\n\nafter'));
});

test('an AltGr-style insert at the focused note lands in a new paragraph below', async ({
	page
}) => {
	await focusNoteFromAbove(page);
	await page.keyboard.insertText('€');
	await expectMirror(page, BLOCK_VIEWS_SOURCE.replace('```\n\nafter', '```\n\n€\n\nafter'));
});

test('ArrowUp on the textarea’s first line leaves the note and commits', async ({ page }) => {
	await page.locator('.note-text').dblclick();
	await expect(page.locator('.note-source')).toBeFocused();
	await page.keyboard.press('ControlOrMeta+Home');
	await page.keyboard.type('top ');
	await page.keyboard.press('ArrowUp');

	await expect.poll(() => activeText(page)).toContain(' chip');
	await expectMirror(page, BLOCK_VIEWS_SOURCE.replace('hello note', 'top hello note'));
});

test('Escape drops the edit and leaves the note focused whole', async ({ page }) => {
	await page.locator('.note-text').dblclick();
	await expect(page.locator('.note-source')).toBeFocused();
	await page.keyboard.type('zzz');
	await page.keyboard.press('Escape');

	await expect(page.locator('.note-text')).toHaveText('hello note\n');
	await expect.poll(() => noteFocusedWhole(page)).toBe(true);
	expect(await mirror(page).textContent()).toBe(BLOCK_VIEWS_SOURCE);
});

test('Alt+ArrowUp moves the focused note above the paragraph before it, still focused whole', async ({
	page
}) => {
	await focusNoteFromAbove(page);
	await page.keyboard.press('Alt+ArrowUp');

	const note = '```note\nhello note\n```';
	await expectMirror(
		page,
		BLOCK_VIEWS_SOURCE.replace(`a {{pebble}} chip\n\n${note}`, `${note}\n\na {{pebble}} chip`)
	);
	await expect.poll(() => noteFocusedWhole(page)).toBe(true);
});

test('Backspace at the focused note deletes it, and undo brings it back', async ({ page }) => {
	await focusNoteFromAbove(page);
	await page.keyboard.press('Backspace');
	await expect.poll(() => mirror(page).textContent()).not.toContain('```note');

	await page.keyboard.press('ControlOrMeta+z');
	await expectMirror(page, BLOCK_VIEWS_SOURCE);
});
