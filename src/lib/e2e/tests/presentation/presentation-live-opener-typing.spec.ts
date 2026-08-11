import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickBlockSettled, enterPresentationMode } from './helpers';

// A block whose only bytes are its own chrome has nothing to stand behind it, so the chrome
// paints: a caret can land on it and a typed byte seats after it. A destructive key at the block's
// own structure follows the mode; one at an inline construct follows the paint. The oracles are
// the source bytes (which side a typed byte landed on) and the marker's computed display.
// Requirements: e2e/requirements/presentation/presentation-live-opener-typing.md.

const OPENER = 0;
const TYPED = 1;

/** A bare `#` and an empty fence: the load half of the same class, with no typing at all. */
const LOADED = ['#', '', '```', '```', '', 'para'].join('\n') + '\n';

/** A link with no text: five painted bytes, none of which any rung may treat as unseen. */
const EMPTY_LINK = '[](u)\n';

/** An empty paragraph below a settled one, minted by the gesture that mints it in use. */
async function emptyBlockBelow(page: Page, mode: 'live' | 'preview-inline'): Promise<EditorPage> {
	const ep = await enterPresentationMode(page, mode, 'lorem\n');
	await clickBlockSettled(ep, OPENER);
	await page.keyboard.press('End');
	await ep.waitForRenderFlush();
	await page.keyboard.press('Enter');
	await ep.bridge.waitForBlockCount(2);
	return ep;
}

/** Settle on the typed bytes having landed — WHERE they landed is the assertion. */
async function typeSettled(ep: EditorPage, page: Page, text: string): Promise<void> {
	for (const ch of text) {
		const before = await ep.bridge.getSource();
		await page.keyboard.type(ch);
		await ep.bridge.waitForSourceWith((source, previous) => source !== previous, before);
		await ep.waitForRenderFlush();
	}
}

const markerOf = (ep: EditorPage, index: number) =>
	ep.getBlock(index).locator('.md-marker').first();

test.describe('live mode — a typed block opener paints until it has content', () => {
	test('typing `#` paints the marker the keystroke just minted', async ({ page }) => {
		const ep = await emptyBlockBelow(page, 'live');

		await typeSettled(ep, page, '#');

		expect(await ep.bridge.getBlockKind(TYPED)).toBe('heading');
		await expect(markerOf(ep, TYPED)).toHaveCSS('display', 'inline');
	});

	test('the next letter lands after the painted marker, not in front of it', async ({ page }) => {
		const ep = await emptyBlockBelow(page, 'live');
		await typeSettled(ep, page, '#');

		await typeSettled(ep, page, 'a');

		await expect.poll(() => ep.bridge.getBlockKind(TYPED)).toBe('paragraph');
		expect(await ep.bridge.getSource()).toContain('#a');
	});

	test('a space keeps the heading painted; the first content character folds it', async ({
		page
	}) => {
		const ep = await emptyBlockBelow(page, 'live');
		await typeSettled(ep, page, '#');

		await typeSettled(ep, page, ' ');
		expect(await ep.bridge.getSource()).toContain('# ');
		expect(await ep.bridge.getBlockKind(TYPED)).toBe('heading');
		await expect(markerOf(ep, TYPED)).toHaveCSS('display', 'inline');

		await typeSettled(ep, page, 'a');
		expect(await ep.bridge.getSource()).toContain('# a');
		expect(await ep.bridge.getBlockKind(TYPED)).toBe('heading');
		await expect(markerOf(ep, TYPED)).toHaveCSS('display', 'none');
	});

	test('three backticks paint their fence line, and the info string appends after it', async ({
		page
	}) => {
		const ep = await emptyBlockBelow(page, 'live');

		await typeSettled(ep, page, '```');
		expect(await ep.bridge.getBlockKind(TYPED)).toBe('fencedCode');
		await expect(ep.getBlock(TYPED).locator('.md-fence-line').first()).toHaveCSS(
			'display',
			'inline'
		);

		await typeSettled(ep, page, 'js');
		expect(await ep.bridge.getSource()).toContain('```js');
	});

	// The demote arm reads the walk's landable bound, so painting the chrome makes the press
	// the marker-byte delete source mode has always performed.
	test('Backspace inside a painted `# ` takes the marker byte and does not demote', async ({
		page
	}) => {
		const ep = await emptyBlockBelow(page, 'live');
		await typeSettled(ep, page, '# ');

		const before = await ep.bridge.getSource();
		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceWith((source, previous) => source !== previous, before);

		expect(await ep.bridge.getBlockKind(TYPED)).toBe('heading');
		await expect(markerOf(ep, TYPED)).toHaveCSS('display', 'inline');
	});

	// The other end of the same press: raw 0 is reachable once the chrome paints, and there one
	// press drops the construct rather than merging upward — a live-only outcome, since source
	// mode at raw 0 is a dead key today.
	test('Backspace at the start of a painted `# ` drops the construct in one press', async ({
		page
	}) => {
		const ep = await emptyBlockBelow(page, 'live');
		await typeSettled(ep, page, '# ');
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceNotContains('#');

		expect(await ep.bridge.getBlockKind(TYPED)).toBe('paragraph');
		expect(await ep.bridge.getBlockCount()).toBe(2);

		await ep.undo();
		await ep.bridge.waitForSourceContains('# ');
	});
});

test.describe('loaded openers — the paint half needs no typing', () => {
	test('live paints a bare heading and an empty fence instead of ghosting them', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'live', LOADED);

		await expect(markerOf(ep, OPENER)).toHaveCSS('display', 'inline');
		const fenceLines = ep.getBlock(1).locator('.md-fence-line');
		await expect(fenceLines).toHaveCount(2);
		await expect(fenceLines.first()).toHaveCSS('display', 'inline');
		await expect(fenceLines.last()).toHaveCSS('display', 'inline');
	});

	// The preview rungs reveal on FOCUS; a content-empty block paints unfocused, where they
	// would otherwise show the same ghost live did.
	test('preview-inline paints the same chrome on an unfocused block', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'preview-inline', LOADED);

		await expect(markerOf(ep, OPENER)).toHaveCSS('display', 'inline');
		await expect(ep.getBlock(1).locator('.md-fence-line').first()).toHaveCSS('display', 'inline');
	});

	// Reading takes no keystrokes, so it keeps the rendered document's silence.
	test('reading mode paints neither', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'reading', LOADED);

		await expect(markerOf(ep, OPENER)).toHaveCSS('display', 'none');
		await expect(ep.getBlock(1).locator('.md-fence-line').first()).toHaveCSS('display', 'none');
	});
});

// The two rungs run the same three gestures: where every byte is on screen, live owes source
// parity, and the assertion is the whole source rather than a substring — `[](u` sits inside
// `[](u)`, so only equality distinguishes one byte gone from none.
for (const mode of ['live', 'source'] as const) {
	test.describe(`painted inline chrome — ${mode} takes what the reader aimed at`, () => {
		let ep: EditorPage;

		test.beforeEach(async ({ page }) => {
			ep = await enterPresentationMode(page, mode, EMPTY_LINK);
			await clickBlockSettled(ep, OPENER);
		});

		test('Backspace at the end takes one byte', async ({ page }) => {
			await page.keyboard.press('End');
			await ep.waitForRenderFlush();

			await page.keyboard.press('Backspace');
			await expect.poll(() => ep.bridge.getSource()).toBe('[](u\n');
		});

		test('Delete at the start takes one byte', async ({ page }) => {
			await page.keyboard.press('Home');
			await ep.waitForRenderFlush();

			await page.keyboard.press('Delete');
			await expect.poll(() => ep.bridge.getSource()).toBe('](u)\n');
		});

		test('a letter typed at the end appends', async ({ page }) => {
			await page.keyboard.press('End');
			await ep.waitForRenderFlush();

			await page.keyboard.type('a');
			await expect.poll(() => ep.bridge.getSource()).toBe('[](u)a\n');
		});
	});
}
