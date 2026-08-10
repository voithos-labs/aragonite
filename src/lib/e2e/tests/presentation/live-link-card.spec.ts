import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';
import {
	centerOfWord,
	clickWordSettled,
	enterPresentationMode,
	extendTo,
	landAt,
	trailingEdgeOfWord
} from './helpers';
import { findInput } from '../search/helpers';

// The anchored chrome that replaces the destination live mode hides.
// Requirements: e2e/requirements/presentation/live-link-card.md.

const DOC = [
	'Visit [example](https://example.com) now',
	'',
	'Click [danger](javascript:alert(1)) here',
	'',
	'See <https://commonmark.org> too',
	'',
	'Read [docs][ref] later',
	'',
	'[ref]: https://example.com/docs'
].join('\n');

const CARD = '[data-link-card]';
const URL_FIELD = `${CARD} input`;

/** A real click on the rendered link text — the only gesture that opens the card. */
async function clickLink(ep: EditorPage, page: Page, word: string): Promise<void> {
	const point = await centerOfWord(page, word);
	await page.mouse.click(point.x, point.y);
	await ep.waitForRenderFlush();
}

async function openCardOn(ep: EditorPage, page: Page, word: string): Promise<void> {
	await clickLink(ep, page, word);
	await expect(page.locator(CARD)).toBeVisible();
}

/** Walk the caret to the start of an EARLIER block with arrows alone: a click there would dismiss
 *  the card before the edit could land. */
async function stepToBlockStart(ep: EditorPage, page: Page, index: number): Promise<void> {
	for (let i = 0; i < 12; i++) {
		const focus = (await ep.bridge.getSelectionPaths())?.focus;
		if (focus?.path.join() === String(index)) {
			await page.keyboard.press('Home');
			return;
		}
		await page.keyboard.press('ArrowUp');
		await ep.waitForRenderFlush();
	}
	throw new Error(`stepToBlockStart: never reached block ${index}`);
}

/** Step into the card's field the way a user does — the caret stays in the document until then. */
async function editUrl(page: Page, url: string): Promise<void> {
	await page.locator(URL_FIELD).click();
	await expect(page.locator(URL_FIELD)).toBeFocused();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.type(url);
}

test.describe('live-mode link card', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterPresentationMode(page, 'live', DOC);
	});

	test('a click on a link opens an anchored dialog holding the hidden destination', async ({
		page
	}) => {
		await openCardOn(ep, page, 'example');

		const card = page.locator(CARD);
		await expect(card).toHaveAttribute('role', 'dialog');
		await expect(card).toHaveAttribute('aria-label', /link/i);
		await expect(page.locator(URL_FIELD)).toHaveValue('https://example.com');

		// Anchored to the link's own box, not to a page corner.
		const linkBox = (await page.locator('a.md-link-content').first().boundingBox())!;
		const cardBox = (await card.boundingBox())!;
		expect(cardBox.y).toBeGreaterThanOrEqual(linkBox.y);
		expect(Math.abs(cardBox.x - linkBox.x)).toBeLessThan(60);
	});

	test('a drag-select inside the link keeps the selection and opens no card', async ({ page }) => {
		const from = await centerOfWord(page, 'example');
		const to = await trailingEdgeOfWord(page, 'example');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(to.x, to.y, { steps: 4 });
		await page.mouse.up();
		await ep.waitForRenderFlush();

		await expect(page.locator(CARD)).toHaveCount(0);
		expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(false);
	});

	test('a blocked-scheme link renders as a span and still opens the card', async ({ page }) => {
		await expect(page.locator('span.md-link-blocked')).toHaveCount(1);
		await openCardOn(ep, page, 'danger');
		await expect(page.locator(URL_FIELD)).toHaveValue('javascript:alert(1)');
	});

	test('an autolink opens no card: its destination is the text already on screen', async ({
		page
	}) => {
		await expect(page.locator('a.md-autolink')).toHaveCount(1);
		await clickLink(ep, page, 'commonmark');
		await expect(page.locator(CARD)).toHaveCount(0);
	});

	test('the opening click leaves the caret in the document, so link TEXT stays editable', async ({
		page
	}) => {
		await openCardOn(ep, page, 'example');

		expect((await ep.bridge.getSelectionPaths())?.focus.path).toEqual([0]);
		await landAt(ep, page, 11);
		await page.keyboard.type('!');
		await ep.bridge.waitForSourceMatches(/\[exam!ple\]/);
	});

	test('Enter rewrites only the destination, as ONE undo entry', async ({ page }) => {
		await openCardOn(ep, page, 'example');

		await editUrl(page, 'https://elsewhere.test/x');
		await page.keyboard.press('Enter');

		await ep.bridge.waitForSourceContains('[example](https://elsewhere.test/x)');
		await expect(page.locator(CARD)).toHaveCount(0);
		expect(await ep.bridge.getSource()).toContain('Visit [example](https://elsewhere.test/x) now');

		// The caret comes back to the construct, not to the block's start: `Visit ` is 6 bytes.
		await expect
			.poll(async () => (await ep.bridge.getSelectionPaths())?.focus)
			.toEqual({
				path: [0],
				offset: 6
			});

		await ep.undo();
		await ep.bridge.waitForSourceContains('[example](https://example.com)');
	});

	// The 0.9.36 stale-draft class, on the surface that inherited its seeding shape: an open card
	// holds a copy of the destination, and the document can move past it while it is open.
	test('an undo taken while the card is open re-seeds it, so Enter commits nothing stale', async ({
		page
	}) => {
		await openCardOn(ep, page, 'example');
		await editUrl(page, 'https://committed.test/1');
		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('https://committed.test/1');

		// Reopen on the SAME link: same path and construct start, so nothing keys a remount.
		await openCardOn(ep, page, 'example');
		await expect(page.locator(URL_FIELD)).toHaveValue('https://committed.test/1');

		// The caret is still the document's while the card is open, so this undo is a real one.
		await ep.undo();
		await ep.bridge.waitForSourceContains('[example](https://example.com)');
		await expect(page.locator(URL_FIELD)).toHaveValue('https://example.com');

		// Enter over the re-seeded draft must not put the undone bytes back.
		await page.locator(URL_FIELD).click();
		await page.keyboard.press('Enter');
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toContain('[example](https://example.com)');
	});

	test('Escape writes nothing and puts the caret back where the click seated it', async ({
		page
	}) => {
		const before = await ep.bridge.getSource();
		await openCardOn(ep, page, 'example');
		const seated = (await ep.bridge.getSelectionPaths())!.focus;
		await editUrl(page, 'https://never.test');

		await page.keyboard.press('Escape');

		await expect(page.locator(CARD)).toHaveCount(0);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
		await expect.poll(async () => (await ep.bridge.getSelectionPaths())?.focus).toEqual(seated);
	});

	test('remove-link leaves the text the reader was already seeing', async ({ page }) => {
		await openCardOn(ep, page, 'example');

		await page.getByRole('button', { name: 'Remove link' }).click();

		await ep.bridge.waitForSourceContains('Visit example now');
		expect(await ep.bridge.getSource()).not.toContain('[example]');
	});

	test('an edit landing elsewhere re-anchors the card instead of stranding it', async ({
		page
	}) => {
		await openCardOn(ep, page, 'docs');
		const beforeBox = (await page.locator(CARD).boundingBox())!;

		// The caret is the document's while the card is open, so a block ABOVE the link is reachable
		// by keyboard alone — no press, which is what would dismiss the card. Typing there grows the
		// block and moves the link down under an open card.
		await stepToBlockStart(ep, page, 0);
		await ep.typeText('padding words '.repeat(60));
		await ep.waitForRenderFlush();

		await expect(page.locator(CARD)).toBeVisible();
		await expect
			.poll(async () => (await page.locator(CARD).boundingBox())!.y)
			.toBeGreaterThan(beforeBox.y);
		await expect(page.locator(URL_FIELD)).toHaveValue('https://example.com/docs');
	});

	test('a reference link’s URL edit inlines the destination and leaves the definition alone', async ({
		page
	}) => {
		await openCardOn(ep, page, 'docs');
		await expect(page.locator(URL_FIELD)).toHaveValue('https://example.com/docs');

		await editUrl(page, 'https://example.com/new');
		await page.keyboard.press('Enter');

		await ep.bridge.waitForSourceContains('Read [docs](https://example.com/new) later');
		expect(await ep.bridge.getSource()).toContain('[ref]: https://example.com/docs');
	});

	test('a press outside closes the card without writing', async ({ page }) => {
		const before = await ep.bridge.getSource();
		await openCardOn(ep, page, 'example');

		await ep.clickBlock(2);

		await expect(page.locator(CARD)).toHaveCount(0);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});

	test('open-link goes through the url policy, which refuses a blocked scheme', async ({
		context,
		page
	}) => {
		let popupFired = false;
		context.on('page', () => {
			popupFired = true;
		});
		await openCardOn(ep, page, 'danger');

		// The button is DISABLED rather than inert on click: the draft rides the render path's own
		// href funnel now, and a blocked scheme resolves to nothing to hand onward. The card still
		// opens on the link, which is how its URL gets repaired.
		const open = page.getByRole('button', { name: 'Open link' });
		await expect(open).toBeDisabled();
		await open.click({ force: true });

		// 200ms — verifying the ABSENCE of a popup, which has no observable state to predicate on.
		await page.waitForTimeout(200);
		expect(popupFired).toBe(false);
	});

	test('Mod+K with the caret inside a link enters the card, field focused', async ({ page }) => {
		// A click seats the caret in the link's text; the chord is what ENTERS the card.
		await clickLink(ep, page, 'example');
		await page.keyboard.press('Escape');
		await expect(page.locator(CARD)).toHaveCount(0);

		await page.keyboard.press('ControlOrMeta+k');

		await expect(page.locator(CARD)).toBeVisible();
		await expect(page.locator(URL_FIELD)).toBeFocused();
		await expect(page.locator(URL_FIELD)).toHaveValue('https://example.com');
	});

	test('an entered card commits on Enter and hands the caret back', async ({ page }) => {
		await clickLink(ep, page, 'example');
		await page.keyboard.press('Escape');
		await page.keyboard.press('ControlOrMeta+k');
		await expect(page.locator(URL_FIELD)).toBeFocused();

		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('https://chord.test/x');
		await page.keyboard.press('Enter');

		await ep.bridge.waitForSourceContains('[example](https://chord.test/x)');
		await expect(page.locator(CARD)).toHaveCount(0);
		await expect
			.poll(async () => (await ep.bridge.getSelectionPaths())?.focus)
			.toEqual({
				path: [0],
				offset: 6
			});
	});

	test('Escape from an entered card puts the caret back where it was', async ({ page }) => {
		await clickLink(ep, page, 'example');
		await page.keyboard.press('Escape');
		const seated = (await ep.bridge.getSelectionPaths())!.focus;
		await page.keyboard.press('ControlOrMeta+k');
		await expect(page.locator(URL_FIELD)).toBeFocused();

		await page.keyboard.press('Escape');

		await expect(page.locator(CARD)).toHaveCount(0);
		await expect.poll(async () => (await ep.bridge.getSelectionPaths())?.focus).toEqual(seated);
	});

	// Narrowed from "outside every link" when the create half shipped (#119): a SELECTION now
	// creates; a bare collapsed caret minting an empty `[](url)` stays a separate UX decision.
	test('Mod+K at a collapsed caret outside every link stays a no-op', async ({ page }) => {
		const before = await ep.bridge.getSource();
		await ep.clickBlock(2);

		await page.keyboard.press('ControlOrMeta+k');

		await expect(page.locator(CARD)).toHaveCount(0);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});

	// A card whose target stops resolving unrenders, and a target left SET would resurrect it the
	// moment an undo made the construct resolve again — holding the draft from before.
	test('a card closed by a shifted construct start stays closed through the undo', async ({
		page
	}) => {
		await openCardOn(ep, page, 'example');

		// Typing at the block's START moves the link's `sourceStart`, which is half the card's
		// target identity: the card addresses a construct that is no longer there.
		await page.keyboard.press('Home');
		await ep.typeText('Z');
		await ep.bridge.waitForSourceContains('ZVisit [example]');
		await expect(page.locator(CARD)).toHaveCount(0);

		await ep.undo();

		await ep.bridge.waitForSourceNotContains('ZVisit');
		await expect(page.locator(CARD)).toHaveCount(0);
	});

	// One caret slot per consumer: a card opened over an open search bar must not overwrite the
	// pre-search caret, or closing the bar lands the user at the link instead.
	test('a card opened over the search bar leaves the pre-search caret alone', async ({ page }) => {
		await ep.clickBlock(2);
		await page.keyboard.press('Home');
		const preSearch = (await ep.bridge.getSelectionPaths())!.focus;

		await page.keyboard.press(`${primaryModifier}+f`);
		await expect(findInput(page)).toBeFocused();
		await page.keyboard.type('later');

		await openCardOn(ep, page, 'example');
		expect((await ep.bridge.getSelectionPaths())?.focus.path).toEqual([0]);

		// One Escape: the card closes without claiming the key (it holds no focus), and the bar's
		// close restores the caret it saved.
		await page.keyboard.press('Escape');
		await expect(findInput(page)).toHaveCount(0);

		await expect.poll(async () => (await ep.bridge.getSelectionPaths())?.focus).toEqual(preSearch);
		await ep.typeText('Z');
		await ep.bridge.waitForSourceContains('ZSee <https://commonmark.org> too');
	});

	test('Tab is trapped once focus is inside the open card', async ({ page }) => {
		await openCardOn(ep, page, 'example');
		await page.locator(URL_FIELD).click();

		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: 'Open link' })).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: 'Remove link' })).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(page.locator(URL_FIELD)).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(page.getByRole('button', { name: 'Remove link' })).toBeFocused();
	});
});

// ── The chord's create half (#119) ──────────────────────────────────────────

const CREATE_DOC = [
	'Alpha bravo charlie',
	'',
	'Visit [example](https://example.com) now',
	'',
	'| alpha | beta |',
	'| --- | --- |',
	'| plain cell | word |'
].join('\n');

/** Shift-extend `count` glyphs right — a real selection gesture, the create target's shape. */
async function selectRight(ep: EditorPage, page: Page, count: number): Promise<void> {
	for (let i = 0; i < count; i++) {
		await page.keyboard.press('Shift+ArrowRight');
	}
	await ep.waitForRenderFlush();
}

/** Land at raw offset 6 of block 0 and select `bravo` — the create rows' shared range. */
async function selectBravo(ep: EditorPage, page: Page): Promise<void> {
	await clickWordSettled(ep, page, 'Alpha');
	await landAt(ep, page, 6);
	await selectRight(ep, page, 5);
}

test.describe('live-mode link card — the create half of Mod+K', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterPresentationMode(page, 'live', CREATE_DOC);
	});

	test('the chord over a selected word opens an empty card; Enter mints ONE undo entry', async ({
		page
	}) => {
		await selectBravo(ep, page);
		const before = await ep.bridge.getSource();

		await page.keyboard.press('ControlOrMeta+k');

		// Entered, empty, and the document untouched: the construct is minted only on commit.
		await expect(page.locator(CARD)).toBeVisible();
		await expect(page.locator(URL_FIELD)).toBeFocused();
		await expect(page.locator(URL_FIELD)).toHaveValue('');
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);

		await page.keyboard.type('https://new.test/b');
		await page.keyboard.press('Enter');

		await ep.bridge.waitForSourceContains('Alpha [bravo](https://new.test/b) charlie');
		await expect(page.locator(CARD)).toHaveCount(0);
		// The card-commit caret rule: the construct's own start.
		await expect
			.poll(async () => (await ep.bridge.getSelectionPaths())?.focus)
			.toEqual({ path: [0], offset: 6 });

		await ep.undo();
		await ep.bridge.waitForSourceEquals(before, 3000);
	});

	test('Escape leaves the document byte-identical and the selection live', async ({ page }) => {
		await selectBravo(ep, page);
		const before = await ep.bridge.getSource();

		await page.keyboard.press('ControlOrMeta+k');
		await expect(page.locator(URL_FIELD)).toBeFocused();
		await page.keyboard.type('https://never.test');

		await page.keyboard.press('Escape');

		await expect(page.locator(CARD)).toHaveCount(0);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
		// The range rides the caret-restore slot while the card borrows focus; Escape re-arms it.
		await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('bravo');
		expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(false);
	});

	test('a selection crossing a link declines create: no card, not a byte', async ({ page }) => {
		await clickWordSettled(ep, page, 'Visit');
		await landAt(ep, page, 2);
		const before = await ep.bridge.getSource();
		// Extend until the focus sits inside the link text — raw 10 of block 1 is in `example`.
		await extendTo(ep, page, 'ArrowRight', [1], 10);

		await page.keyboard.press('ControlOrMeta+k');
		await ep.waitForRenderFlush();

		await expect(page.locator(CARD)).toHaveCount(0);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});

	test('a selection inside a table cell declines create', async ({ page }) => {
		await clickWordSettled(ep, page, 'plain');
		await selectRight(ep, page, 3);
		expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(false);
		const before = await ep.bridge.getSource();

		await page.keyboard.press('ControlOrMeta+k');
		await ep.waitForRenderFlush();

		await expect(page.locator(CARD)).toHaveCount(0);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});
});

// ── The chord's consumption contract ────────────────────────────────────────

const CHORD_DOC = [
	'Visit [example](https://example.com) now',
	'',
	'plain words here',
	'',
	'```',
	'fenced',
	'```'
].join('\n');

/**
 * `defaultPrevented` read at a document BUBBLE listener, where every editor handler has already
 * run: `false` means the press reached the browser's own Mod+K defaults — Chrome's omnibox, and
 * on macOS the contenteditable kill-to-end-of-line the `Mod` fold routes here — on a chord
 * `reservedChords()` reports as consumed.
 */
async function modKConsumed(ep: EditorPage, page: Page): Promise<boolean | null> {
	await page.evaluate(() => {
		const probe = window as Window & { __modK?: { consumed: boolean | null } };
		if (!probe.__modK) {
			const slot: { consumed: boolean | null } = { consumed: null };
			probe.__modK = slot;
			document.addEventListener('keydown', (e) => {
				if (e.key === 'k' || e.key === 'K') slot.consumed = e.defaultPrevented;
			});
		}
		probe.__modK.consumed = null;
	});
	await page.keyboard.press('ControlOrMeta+k');
	await ep.waitForRenderFlush();
	return page.evaluate(
		() => (window as Window & { __modK?: { consumed: boolean | null } }).__modK?.consumed ?? null
	);
}

test.describe('live-mode link card — Mod+K is consumed wherever it is bound', () => {
	test('a caret outside every link consumes the press and opens no card', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', CHORD_DOC);
		await ep.clickBlock(1);
		const before = await ep.bridge.getSource();

		expect(await modKConsumed(ep, page)).toBe(true);

		await expect(page.locator(CARD)).toHaveCount(0);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});

	// The same caret that ENTERS the card in live mode: source paints the destination already, so
	// the chord has nothing to do here — which is not the same as handing the key back.
	test('source mode consumes the press with the caret inside a link', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', CHORD_DOC);
		await clickWordSettled(ep, page, 'example');
		const before = await ep.bridge.getSource();

		expect(await modKConsumed(ep, page)).toBe(true);

		await expect(page.locator(CARD)).toHaveCount(0);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});

	test('a fenced code block consumes the press', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', CHORD_DOC);
		await ep.clickBlock(2);
		const before = await ep.bridge.getSource();

		expect(await modKConsumed(ep, page)).toBe(true);

		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});

	test("the open card's own URL field consumes the press", async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', CHORD_DOC);
		await openCardOn(ep, page, 'example');
		await page.locator(URL_FIELD).click();
		await expect(page.locator(URL_FIELD)).toBeFocused();

		expect(await modKConsumed(ep, page)).toBe(true);

		await expect(page.locator(CARD)).toBeVisible();
		await expect(page.locator(URL_FIELD)).toBeFocused();
	});
});
