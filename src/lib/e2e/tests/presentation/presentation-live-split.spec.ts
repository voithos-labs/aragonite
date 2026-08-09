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
	'plain words here',
	'',
	'Ref [refexample][site] here',
	'',
	'[site]: https://example.com'
].join('\n');

const BOLD = 0;
const LINK = 1;
const NESTED = 2;
const PLAIN = 3;
const REF = 4;
/** The fixture's block count, so a merge row asserts "back to where it started" rather than a
 *  literal that a new fixture block silently invalidates. */
const BLOCKS = DOC.split('\n\n').length;

const enterMode = (page: Page, mode: 'live' | 'source') => enterPresentationMode(page, mode, DOC);

/** What a block SHOWS: its content text minus every span a marker-hiding mode paints nothing
 *  for. Read off the page object's own block-content element, never the host — the chrome
 *  between the wrapper's children contributes whitespace text nodes of its own. */
async function visibleText(ep: EditorPage, block: number): Promise<string> {
	return ep.getBlock(block).evaluate((el) => {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let out = '';
		let node: Node | null;
		while ((node = walker.nextNode())) {
			if (!node.parentElement?.closest('.md-marker, .md-ref-label, .md-fence-line')) {
				out += node.textContent ?? '';
			}
		}
		return out;
	});
}


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

// A block's TERMINAL whitespace paints nothing (a hard break with no line after it), so a cut
// that would strand it drops it: carrying it made the pair reload as a different shape (#106),
// and declining to the byte-literal cut printed the delimiters the reader never saw.
test.describe('live mode — a cut that would strand terminal whitespace', () => {
	const TRAILING = ['~~foo~~  ', '', 'tail'].join('\n');

	test('leaves no delimiter on screen, and the reload agrees', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', TRAILING);
		await clickWordSettled(ep, page, 'foo');
		await stepTo(ep, page, 'ArrowRight', 5);

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('~~foo~~\n\n');

		// The screen is what licensed the drop, so the screen is what it answers to.
		expect(await visibleText(ep, 0)).toBe('foo');
		expect(await visibleText(ep, 1)).toBe('');
		expect(await ep.bridge.getSource()).not.toContain('~~foo\n');

		// Reload convergence: the bytes the split wrote come back as the same screen.
		const written = await ep.bridge.getSource();
		await ep.loadContent(written);
		await ep.waitForRenderFlush();
		expect(await ep.bridge.getSource()).toBe(written);
		expect(await visibleText(ep, 0)).toBe('foo');
	});
});

// The split's inverse. Without seam cleanup the closing and reopening runs landed back to back —
// `Some **bo****ld** text`, gaining a pair on every repeat, and a split link returning as two
// anchors on one destination.
test.describe('live mode — Enter then Backspace round-trips', () => {
	test('merging the halves back restores the original bytes', async ({ page }) => {
		const ep = await enterMode(page, 'live');
		await clickWordSettled(ep, page, 'bold');
		await stepTo(ep, page, 'ArrowRight', 9);

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('Some **bo**');
		await page.keyboard.press('Backspace');
		await expect.poll(() => ep.getBlocks().count()).toBe(BLOCKS);

		expect(await ep.bridge.getSource()).toContain('Some **bold** text');
		expect(await ep.bridge.getSource()).not.toContain('****');
	});

	test('merging a split link back leaves one link, not two', async ({ page }) => {
		const ep = await enterMode(page, 'live');
		await clickWordSettled(ep, page, 'example');
		await stepTo(ep, page, 'ArrowRight', 11);

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('[exam](https://example.com)');
		await page.keyboard.press('Backspace');
		await expect.poll(() => ep.getBlocks().count()).toBe(BLOCKS);

		expect(await ep.bridge.getSource()).toContain('Visit [example](https://example.com) here');
		expect(await ep.getBlock(LINK).locator('a').count()).toBe(1);
	});
});

// The resolver rides the split call, so the seam sees a reference form as the LINK the render path
// drew rather than as brackets — the decline that used to leak them.
test.describe('live mode — a reference form splits like any other link', () => {
	test('both halves carry the reference label', async ({ page }) => {
		const ep = await enterMode(page, 'live');
		await clickWordSettled(ep, page, 'refexample');
		await stepTo(ep, page, 'ArrowRight', 10);

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('Ref [refex][site]\n\n[ample][site] here');
		await expect(ep.getBlock(REF).locator('a')).toHaveText('refex', { useInnerText: true });
		await expect(ep.getBlock(REF + 1).locator('a')).toHaveText('ample', { useInnerText: true });
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
