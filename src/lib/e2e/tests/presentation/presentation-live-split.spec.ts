import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import {
	clickBlockSettled,
	clickWordSettled,
	enterPresentationMode,
	focusOffset,
	landAt,
	stepTo
} from './helpers';
import { textOutsideMarkers } from '../../text-runs';

// What Enter inside a construct writes in live mode: a closed pair above, a reopened one below,
// and the URL of a split link in both halves. The source is the reference, because a hidden
// delimiter and an absent one look identical on screen.
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

test.describe('live mode: Enter inside a construct closes and reopens it', () => {
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

	// The caret reports the second block's raw 0, which is the same pixel as the reopened run's
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
// pixel, so a cut at that edge is the one that could create a pair enclosing nothing.
test.describe('live mode: a cut at a construct edge hands it over whole', () => {
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

// Whitespace at a block's end paints nothing, so a cut that would strand it drops it: kept, the
// pair would reload as a different shape.
test.describe('live mode: a cut that would strand terminal whitespace', () => {
	const TRAILING = ['~~foo~~  ', '', 'tail'].join('\n');

	test('leaves no delimiter on screen, and the reload agrees', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', TRAILING);
		await clickWordSettled(ep, page, 'foo');
		await stepTo(ep, page, 'ArrowRight', 5);

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('~~foo~~\n\n');

		// The screen is what licensed the drop, so the screen is what it answers to.
		expect(await textOutsideMarkers(ep.getBlock(0))).toBe('foo');
		expect(await textOutsideMarkers(ep.getBlock(1))).toBe('');
		expect(await ep.bridge.getSource()).not.toContain('~~foo\n');

		// Reload convergence: the bytes the split wrote come back as the same screen.
		const written = await ep.bridge.getSource();
		await ep.loadContent(written);
		await ep.waitForRenderFlush();
		expect(await ep.bridge.getSource()).toBe(written);
		expect(await textOutsideMarkers(ep.getBlock(0))).toBe('foo');
	});
});

// A construct with no children has no interior a cut can land in (`docs/design/live-mode.md` §
// 4.4), so the cut moves to its nearer edge and one half takes it whole.
test.describe('live mode: a cut through a childless construct', () => {
	test('takes the whole autolink into the half the caret was nearer', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', '<https://example.com> tail\n');
		await clickWordSettled(ep, page, 'example');
		await landAt(ep, page, 13);
		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('\n\n');

		expect(await ep.bridge.getSource()).toBe('<https://example.com>\n\n tail\n');
		// No bracket reaches the screen on either side, which is the point of moving the cut.
		expect(await textOutsideMarkers(ep.getBlock(0))).toBe('https://example.com');
	});
});

// The split's inverse: without cleanup at the join the closing and reopening runs meet as
// `Some **bo****ld** text`, and a split link comes back as two anchors.
test.describe('live mode: Enter then Backspace round-trips', () => {
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

// The resolver runs inside the split call, so the split sees a reference form as the link the
// render path drew rather than as a pair of brackets.
test.describe('live mode: a reference form splits like any other link', () => {
	test('both halves carry the reference label', async ({ page }) => {
		const ep = await enterMode(page, 'live');
		await clickWordSettled(ep, page, 'refexample');
		await landAt(ep, page, 10);

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('Ref [refex][site]\n\n[ample][site] here');
		await expect(ep.getBlock(REF).locator('a')).toHaveText('refex', { useInnerText: true });
		await expect(ep.getBlock(REF + 1).locator('a')).toHaveText('ample', { useInnerText: true });
	});
});

// A list item's first line sits behind its bullet, so the space the reopened half starts with
// joins the new item's bullet, as a reload reads it.
test.describe('live mode: a cut through a construct in a list item', () => {
	test('the new item takes the wider bullet its bytes read as', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', '- **bo ld**\n');
		await clickWordSettled(ep, page, 'ld');
		await landAt(ep, page, 4);

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceEquals('- **bo**\n-  **ld**\n');

		expect(await ep.parseConverged()).toBe(true);
		const marker = await page.evaluate(
			() => (window as any).__test.getDocument().children[0].children[1].metadata.marker
		);
		expect(marker).toBe('-  ');
		const items = ep.editorContainer.locator('.list-item-content');
		await expect(items.nth(1).locator('strong')).toHaveText('ld', { useInnerText: true });
	});
});

// Source paints every delimiter, so the byte the caret is against is the byte the user aimed at.
test.describe('source mode: the same gesture stays byte-literal', () => {
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
