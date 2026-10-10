import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import {
	clickBlockSettled,
	clickWordSettled,
	enterPresentationMode,
	focusOffset,
	landAt,
	nextRow,
	stepTo
} from './helpers';
import { textOutsideMarkers } from '../../text-runs';

// What Enter inside a construct writes in live mode: a closed pair above and a reopened one below.
// The source is the reference, because a hidden delimiter and an absent one look identical on
// screen. Each test walks its rows as steps, every step on a fresh copy of its document.
// Requirements: e2e/requirements/presentation/presentation-live-split.md.

const DOC = [
	'Some **bold** text',
	'',
	'Ref [refexample][site] here',
	'',
	'[site]: https://example.com'
].join('\n');

const BOLD = 0;
const REF = 1;

const enterMode = (page: Page, mode: 'live' | 'source') => enterPresentationMode(page, mode, DOC);

test('live mode: Enter inside a construct closes and reopens it', async ({ page }) => {
	const ep = await enterMode(page, 'live');
	const atCut = async () => {
		await nextRow(ep, DOC);
		await clickWordSettled(ep, page, 'bold');
		await stepTo(ep, page, 'ArrowRight', 9);
	};

	await test.step('a cut through a bold word leaves two balanced bold constructs', async () => {
		await atCut();

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('Some **bo**\n\n**ld** text');
		await ep.bridge.waitForSourceNotContains('Some **bo\n');

		await expect(ep.getBlock(BOLD)).toHaveText('Some bo', { useInnerText: true });
		await expect(ep.getBlock(BOLD).locator('strong')).toHaveText('bo', { useInnerText: true });
		await expect(ep.getBlock(BOLD + 1).locator('strong')).toHaveText('ld', {
			useInnerText: true
		});
	});

	// Enter starts the new block plain, whatever the text after the cut carries.
	await test.step('the new block starts plain, in front of the reopened construct', async () => {
		await atCut();

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('**ld** text');
		await expect.poll(() => focusOffset(ep)).toBe(0);

		await page.keyboard.insertText('X');
		await ep.bridge.waitForSourceContains('X**ld** text');
		await expect(ep.getBlock(BOLD + 1).locator('strong')).toHaveText('ld', {
			useInnerText: true
		});
	});

	await test.step('one undo restores the original block and its caret', async () => {
		await atCut();
		const before = await ep.bridge.getSource();

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('Some **bo**');

		await ep.undo();
		await expect.poll(() => ep.bridge.getSource()).toBe(before);
		await expect.poll(() => focusOffset(ep)).toBe(9);
	});
});

// A cut where a balanced pair can't stand on both sides hands the construct to one half whole.
test('live mode: a cut the construct cannot take hands it over whole', async ({ page }) => {
	const ep = await enterMode(page, 'live');

	// The caret at a construct's content edge and the caret outside its delimiters are the same
	// pixel, so a cut at that edge is the one that could create a pair enclosing nothing.
	await test.step('at content end the construct stays whole above', async () => {
		await nextRow(ep, DOC);
		await clickWordSettled(ep, page, 'bold');
		await stepTo(ep, page, 'ArrowRight', 11);

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('Some **bold**\n\n text');
		await ep.bridge.waitForSourceNotContains('****');
		await expect(ep.getBlock(BOLD).locator('strong')).toHaveText('bold', { useInnerText: true });
	});

	// Whitespace at a block's end paints nothing, so a cut that would strand it drops it: kept, the
	// pair would reload as a different shape.
	await test.step('a cut that would strand terminal whitespace leaves no delimiter on screen, and the reload agrees', async () => {
		await nextRow(ep, ['~~foo~~  ', '', 'tail'].join('\n'));
		await clickWordSettled(ep, page, 'foo');
		await stepTo(ep, page, 'ArrowRight', 5);

		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('~~foo~~\n\n');

		// The screen is what licensed the drop, so the screen is what it answers to.
		expect(await textOutsideMarkers(ep.getBlock(0))).toBe('foo');
		expect(await textOutsideMarkers(ep.getBlock(1))).toBe('');
		expect(await ep.bridge.getSource()).not.toContain('~~foo\n');

		// Reload convergence: the bytes the split wrote come back as the same screen.
		expect(await ep.parseConverged()).toBe(true);
		await ep.loadContent(await ep.bridge.getSource());
		await ep.waitForRenderFlush();
		expect(await textOutsideMarkers(ep.getBlock(0))).toBe('foo');
		expect(await textOutsideMarkers(ep.getBlock(1))).toBe('');
	});

	// A construct with no children has no interior a cut can land in (`docs/design/live-mode.md`
	// § 4.4), so the cut moves to its nearer edge and one half takes it whole.
	await test.step('a cut through a childless construct takes the whole autolink into the half the caret was nearer', async () => {
		await nextRow(ep, '<https://example.com> tail\n');
		await clickWordSettled(ep, page, 'example');
		await landAt(ep, page, 13);
		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('\n\n');

		expect(await ep.bridge.getSource()).toBe('<https://example.com>\n\n tail\n');
		// No bracket reaches the screen on either side, which is the point of moving the cut.
		expect(await textOutsideMarkers(ep.getBlock(0))).toBe('https://example.com');
	});
});

// The resolver runs inside the split call, so the split sees a reference form as the link the
// render path drew rather than as a pair of brackets.
test('live mode: a reference form splits like any other link, both halves on the label', async ({
	page
}) => {
	const ep = await enterMode(page, 'live');
	await clickWordSettled(ep, page, 'refexample');
	await landAt(ep, page, 10);

	await page.keyboard.press('Enter');
	await ep.bridge.waitForSourceContains('Ref [refex][site]\n\n[ample][site] here');
	await expect(ep.getBlock(REF).locator('a')).toHaveText('refex', { useInnerText: true });
	await expect(ep.getBlock(REF + 1).locator('a')).toHaveText('ample', { useInnerText: true });
});

// A list item's first line sits behind its bullet, so the space the reopened half starts with
// joins the new item's bullet, as a reload reads it.
test('live mode: a cut in a list item gives the new item the wider bullet its bytes read as', async ({
	page
}) => {
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

// Source paints every delimiter, so the byte the caret is against is the byte the user aimed at.
test('source mode: Enter inside a bold word splits the pair open, byte for byte', async ({
	page
}) => {
	const ep = await enterMode(page, 'source');
	await clickBlockSettled(ep, BOLD);
	await page.keyboard.press('Home');
	await ep.waitForRenderFlush();
	await stepTo(ep, page, 'ArrowRight', 9);

	await page.keyboard.press('Enter');
	await ep.bridge.waitForSourceContains('Some **bo\n\nld** text');
});

// A split that cuts no construct reopens nothing, so its landing is a structural one like Home's:
// the caret means outside the construct the second half opens with, in every mode that hides it.
for (const mode of ['live', 'preview-inline'] as const) {
	test(`${mode}: Enter just before a construct leaves the caret outside it`, async ({ page }) => {
		const ep = await enterPresentationMode(page, mode, '\n');

		for (const [what, doc, word, typed] of [
			['a code span', 'ab `code` z', 'code', 'Y`code` z'],
			['a bold run', 'ab **bold** z', 'bold', 'Y**bold** z'],
			['a code span in a list item', '- ab `code` z', 'code', '- Y`code` z']
		] as const) {
			await test.step(`${what}: the next byte lands before it`, async () => {
				await nextRow(ep, doc);
				await clickWordSettled(ep, page, word);
				await landAt(ep, page, 3);
				await page.keyboard.press('Enter');
				await ep.waitForRenderFlush();
				await page.keyboard.type('Y');
				await ep.bridge.waitForSourceContains(typed);
			});
		}
	});
}
