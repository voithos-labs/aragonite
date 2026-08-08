import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import {
	clickBlockSettled,
	clickWordSettled,
	enterPresentationMode,
	focusOffset,
	stepTo
} from './helpers';

// What Enter inside a construct writes in live mode: a closed pair above, a reopened one below,
// and the URL of a split link in both halves. The source is the oracle — a hidden delimiter and
// an absent one look identical on screen.
// Requirements: e2e/requirements/presentation/presentation-live-split.md.

const DOC = [
	'Some **bold** text',
	'',
	'Visit [example](https://example.com) here',
	'',
	'**a *ital* b**',
	'',
	'plain words here'
].join('\n');

const BOLD = 0;
const LINK = 1;
const NESTED = 2;
const PLAIN = 3;

const enterMode = (page: Page, mode: 'live' | 'source') => enterPresentationMode(page, mode, DOC);

test.describe('live mode — Enter inside a construct closes and reopens it', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterMode(page, 'live');
	});

	test('a cut through a bold word leaves two balanced bold constructs', async ({ page }) => {
		await clickWordSettled(ep, page, 'bold');
		await stepTo(ep, page, 'ArrowRight', 9);

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('Some **bo**\n\n**ld** text');
		await ep.bridge.waitForSourceNotContains('Some **bo\n');

		await expect(ep.getBlock(BOLD)).toHaveText('Some bo', { useInnerText: true });
		await expect(ep.getBlock(BOLD).locator('strong')).toHaveText('bo', { useInnerText: true });
		await expect(ep.getBlock(BOLD + 1).locator('strong')).toHaveText('ld', {
			useInnerText: true
		});
	});

	// The caret reports the second block's raw 0, which is the same PIXEL as the reopened run's
	// far side; what the user can observe is where the next byte lands, and it lands inside.
	test('typing continues inside the reopened construct', async ({ page }) => {
		await clickWordSettled(ep, page, 'bold');
		await stepTo(ep, page, 'ArrowRight', 9);

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('**ld** text');
		await expect.poll(() => focusOffset(ep)).toBe(0);

		await page.keyboard.insertText('X');
		await ep.bridge.waitForSourceContains('**Xld** text');
		await expect(ep.getBlock(BOLD + 1).locator('strong')).toHaveText('Xld', {
			useInnerText: true
		});
	});

	test('one undo restores the original block and its caret', async ({ page }) => {
		await clickWordSettled(ep, page, 'bold');
		await stepTo(ep, page, 'ArrowRight', 9);
		const before = await ep.bridge.getSource();

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('Some **bo**');

		await ep.undo();
		await expect.poll(() => ep.bridge.getSource()).toBe(before);
		await expect.poll(() => focusOffset(ep)).toBe(9);
	});

	test('a split link duplicates its destination into both halves', async ({ page }) => {
		await clickWordSettled(ep, page, 'example');
		await stepTo(ep, page, 'ArrowRight', 11);

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('Visit [exam](https://example.com)');
		await ep.bridge.waitForSourceContains('[ple](https://example.com) here');

		await expect(ep.getBlock(LINK).locator('a')).toHaveAttribute('href', 'https://example.com');
		await expect(ep.getBlock(LINK + 1).locator('a')).toHaveAttribute('href', 'https://example.com');
	});

	test('a nested pair reopens outermost-first', async ({ page }) => {
		await clickWordSettled(ep, page, 'ital');
		await stepTo(ep, page, 'ArrowRight', 7);

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('**a *it***\n\n***al* b**');

		await expect(ep.getBlock(NESTED).locator('strong em')).toHaveText('it', {
			useInnerText: true
		});
		await expect(ep.getBlock(NESTED + 1).locator('strong em')).toHaveText('al', {
			useInnerText: true
		});
	});
});

// The caret at a construct's content edge and the caret outside its delimiters are the same
// pixel, so the edge press is the one that could mint a pair enclosing nothing.
test.describe('live mode — a cut at a construct edge hands it over whole', () => {
	test('at content end the construct stays whole above', async ({ page }) => {
		const ep = await enterMode(page, 'live');
		await clickWordSettled(ep, page, 'bold');
		await stepTo(ep, page, 'ArrowRight', 11);

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('Some **bold**\n\n text');
		await ep.bridge.waitForSourceNotContains('****');
		await expect(ep.getBlock(BOLD).locator('strong')).toHaveText('bold', { useInnerText: true });
	});

	test('a cut outside every construct is untouched by the mode', async ({ page }) => {
		const ep = await enterMode(page, 'live');
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowRight', 5);

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('plain\n\n words here');
	});
});

// Source paints every delimiter, so the byte the caret is against is the byte the user aimed at.
test.describe('source mode — the same gesture stays byte-literal', () => {
	test('Enter inside a bold word splits the pair open', async ({ page }) => {
		const ep = await enterMode(page, 'source');
		await clickBlockSettled(ep, BOLD);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowRight', 9);

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('Some **bo\n\nld** text');
	});
});
