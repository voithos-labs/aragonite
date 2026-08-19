import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { primaryModifier } from '../../platform';
import { clickBlockSettled, clickWordSettled, enterPresentationMode, stepTo } from './helpers';
import { attachIme } from '../../simulation/ime';

// A collapsed-caret toggle in live mode writes no bytes; the next insertion carries the mark.
// The source is the oracle — live paints no delimiter, so nothing on screen distinguishes a
// pended mark from an empty pair until bytes exist.
// Requirements: e2e/requirements/presentation/presentation-live-pending-marks.md.

const DOC = [
	'plain',
	'',
	'Some **bold** text',
	'',
	'**hello world**',
	'',
	'see <https://example.com> now',
	'',
	'~~struck~~ tail',
	'',
	'gap  here'
].join('\n');

const PLAIN = 0;
const BOLD = 1;
const PHRASE = 2;
const AUTOLINK = 3;
const STRUCK = 4;
/** Two spaces, so a caret between them has whitespace on BOTH sides — the one collapsed position
 *  where a nested pair's outer run is flanking enough to open and close (`**` before a backtick
 *  after a letter is neither). */
const GAP = 5;

const enterLive = (page: Page) => enterPresentationMode(page, 'live', DOC);

const bold = (page: Page) => page.keyboard.press(`${primaryModifier}+b`);
const italic = (page: Page) => page.keyboard.press(`${primaryModifier}+i`);
const struck = (page: Page) => page.keyboard.press(`${primaryModifier}+Shift+X`);
const code = (page: Page) => page.keyboard.press(`${primaryModifier}+e`);

test.describe('live mode — a pended mark rides the next insertion', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	test('Mod+B then a keystroke writes a wrapped byte that renders bold', async ({ page }) => {
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();

		await bold(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('plain**X**');

		await expect(page.locator('.text-editable-block strong').first()).toHaveText('X');
	});

	test('Mod+B then Mod+I put both marks on one insertion', async ({ page }) => {
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();

		await bold(page);
		await italic(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('plain***X***');
	});

	// `Some **bold** text`: `bold` is [7,11). A mark the chain already carries REMOVES, so the
	// byte escapes the construct rather than nesting a second pair inside it.
	test('a mark pended inside bold unbolds the next insertion', async ({ page }) => {
		await clickWordSettled(ep, page, 'bold');
		await stepTo(ep, page, 'ArrowRight', 9);

		await bold(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some **bo**X**ld** text');
	});

	// The whole reason the byte-pair strategy cannot ship in live: an abandoned toggle would
	// leave `****` the user can see the effect of but never explain.
	test('Mod+B then a click away leaves the bytes untouched', async ({ page }) => {
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();

		const before = await ep.bridge.getSource();
		await bold(page);
		await clickBlockSettled(ep, BOLD);
		await ep.waitForNoSourceMutation();

		expect(await ep.bridge.getSource()).toBe(before);
	});
});

// The two chords no other scenario spends: strikethrough's two-byte run and inline code's
// backtick, whose delimiters the resolver has to write for itself. The nesting rows are the pin
// on the order being the TABLE's and not the chords' — a code span wrapping literal stars is what
// the wrong order produces, and the resolver would decline it and type plain instead.
test.describe('live mode — the marks beyond bold and italic', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	const atEndOfPlain = async (page: Page): Promise<void> => {
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();
	};

	/** Between the two spaces of `gap  here`, reached by real presses from the line start. */
	const atGap = async (page: Page): Promise<void> => {
		await clickBlockSettled(ep, GAP);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowRight', 4);
	};

	test('Mod+Shift+X then a keystroke writes a struck byte', async ({ page }) => {
		await atEndOfPlain(page);
		await struck(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('plain~~X~~');

		await expect(page.locator('.text-editable-block s').first()).toHaveText('X');
	});

	test('Mod+E then a keystroke writes a code byte', async ({ page }) => {
		await atEndOfPlain(page);
		await code(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('plain`X`');

		await expect(page.locator('.text-editable-block code').first()).toHaveText('X');
	});

	test('Mod+B then Mod+E nests the code span inside the strong', async ({ page }) => {
		await atGap(page);
		await bold(page);
		await code(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('gap **`X`** here');
	});

	test('Mod+E then Mod+B writes the same bytes, so the order is the table’s', async ({ page }) => {
		await atGap(page);
		await code(page);
		await bold(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('gap **`X`** here');
	});

	// `~~struck~~ tail`: content is [2,8), so offset 4 sits after `st`. The same close-and-reopen
	// escape bold takes, on the run whose delimiters are two bytes rather than two asterisks.
	test('a mark pended inside a struck phrase splits it open', async ({ page }) => {
		// Home lands past the hidden opener, so the two presses are counted from content start.
		await clickBlockSettled(ep, STRUCK);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowRight', 4);

		await struck(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('~~st~~X~~ruck~~ tail');

		await expect(ep.getBlock(STRUCK)).toHaveText('stXruck tail', { useInnerText: true });
	});
});

// The shape that made the first cut of this resolver ship literal stars: a bold PHRASE, split
// at the space. `**hello**X** world**` reads right and renders `helloX** world**`, because a
// closing run before a space is not left-flanking. The resolver re-parses its own candidate and
// steps outside the construct instead, so what a first session sees here is the whole point.
test.describe('live mode — a removal that would show delimiters steps outside instead', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	test('un-bolding at the space inside a bold phrase never surfaces a delimiter', async ({
		page
	}) => {
		await clickWordSettled(ep, page, 'hello');
		await stepTo(ep, page, 'ArrowRight', 7);

		await bold(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('X**hello world**');

		// What the reader sees: one plain X, and a phrase that is still entirely bold.
		const block = ep.getBlock(PHRASE);
		await expect(block).toHaveText('Xhello world', { useInnerText: true });
		await expect(block.locator('strong')).toHaveText('hello world', { useInnerText: true });
		await expect(block.locator('.md-marker').first()).toHaveCSS('display', 'none');
	});
});

// An autolink is ONE childless span: there is no seam inside it a delimiter can go through, and
// its angle brackets are marker spans the reader has never seen. A wrap inside the URL destroys
// the link and paints them, so the mark declines and the byte types plain.
test.describe('live mode — a mark inside a URL declines rather than destroy the link', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	test('Mod+B inside an autolink’s URL types plain and leaves the link intact', async ({
		page
	}) => {
		await clickBlockSettled(ep, AUTOLINK);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowRight', 10);

		await bold(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('see <httpsX://example.com> now');
		await ep.bridge.waitForSourceNotContains('**X**');

		const block = ep.getBlock(AUTOLINK);
		await expect(block).toHaveText('see httpsX://example.com now', { useInnerText: true });
		await expect(block.locator('.md-autolink')).toHaveCount(1);
		await expect(block.locator('.md-marker').first()).toHaveCSS('display', 'none');
	});
});

test.describe('live mode — a mark is spent once and cleared by any caret move', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	// Spent once, but the caret it left is inside the pair it made, so the NEXT byte extends
	// that construct by the ordinary arrival rule rather than by a second mark.
	test('the second keystroke extends what the first one made, not a second pair', async ({
		page
	}) => {
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();

		await bold(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('plain**X**');

		// Settled first: the mark's commit re-renders the block and restores the caret, and a
		// second byte racing that restore says nothing about whether the mark was spent.
		await page.keyboard.type('Y');
		await ep.bridge.waitForSourceContains('plain**XY**');
	});

	test('an arrow step drops the mark', async ({ page }) => {
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();

		await bold(page);
		await page.keyboard.press('ArrowLeft');
		await ep.waitForRenderFlush();
		await page.keyboard.type('X');

		await ep.bridge.waitForSourceContains('plaiXn');
		await ep.bridge.waitForSourceNotContains('plai**');
	});

	test('a click drops the mark', async ({ page }) => {
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();

		await bold(page);
		await clickWordSettled(ep, page, 'plain');
		await page.keyboard.type('X');

		await ep.bridge.waitForSourceContains('X');
		await ep.bridge.waitForSourceNotContains('plain**');
	});
});

test.describe('live mode — the insertion that spends a mark owns its undo entry', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	// The toggle flushes the keystroke batch, so the insertion that spends it owns its own undo
	// entry rather than coalescing with the words typed before it.
	test('one Mod+Z after a burst, a toggle and a keystroke returns the burst', async ({ page }) => {
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();

		await page.keyboard.type('abc');
		await bold(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('plainabc**X**');

		await ep.undo();
		await ep.bridge.waitForSourceContains('plainabc');
		await ep.bridge.waitForSourceNotContains('**X**');
	});
});

test.describe('live mode — an IME commit spends a mark like a keystroke', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	test('a composition committed after Mod+B lands wrapped', async ({ page }) => {
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();

		await bold(page);
		const ime = await attachIme(page);
		await ime.compose('か');
		await ime.commit('かん');

		await ep.bridge.waitForSourceContains('plain**かん**');
	});
});

// The dispatcher runs `handlePendingMarks` BEFORE `handleCstWidget`, so a plain key beside an
// atomic widget is claimed by the marks arm and the widget arm never sees it. That ordering was
// unverified; these rows pin what the verified path does with it — the rewrite is checked against
// the render path, so a splice that would change painted text is declined and the widget survives
// whole on either side of it.
test.describe('live mode — a pending mark beside an inline widget', () => {
	const WIDGET_DOC = 'see &amp; now\n';

	test('the byte lands before the widget, wrapped, and the entity survives', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto('?presentationMode=live');
		await ep.loadContent(WIDGET_DOC);
		await ep.waitForRenderFlush();

		await ep.focusBlock(0, 4);
		await page.keyboard.press(`${primaryModifier}+b`);
		await ep.waitForRenderFlush();
		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');

		expect(await ep.bridge.getSource()).toBe('see **Z**&amp; now\n');
	});

	test('the byte lands after the widget the same way', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto('?presentationMode=live');
		await ep.loadContent(WIDGET_DOC);
		await ep.waitForRenderFlush();

		// Stepped rather than seated: the widget is one atomic stop, so five presses from the
		// line start clear it — and a DOM-offset seat cannot address the far side of an island.
		await ep.clickBlock(0);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
		await ep.waitForRenderFlush();
		await page.keyboard.press(`${primaryModifier}+b`);
		await ep.waitForRenderFlush();
		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');

		expect(await ep.bridge.getSource()).toBe('see &amp;**Z** now\n');
	});
});
