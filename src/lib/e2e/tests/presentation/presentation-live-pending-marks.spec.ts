import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import {
	clickBlockSettled,
	clickWordSettled,
	enterPresentationMode,
	focusOffset,
	nextRow,
	stepTo
} from './helpers';
import { attachIme } from '../../simulation/ime';

// A toggle at a collapsed caret in live mode writes no bytes; the next insertion carries the
// mark. The source is the reference, because live paints no delimiter, so nothing on screen
// tells a pending mark from an empty pair until bytes exist. Each test walks its rows as steps,
// every step on a fresh copy of the document.
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
/** Two spaces, so a caret between them has whitespace on either side, the one collapsed position
 *  where a nested pair's outer run can both open and close. */
const GAP = 5;

const enterLive = (page: Page) => enterPresentationMode(page, 'live', DOC);

const bold = (page: Page) => page.keyboard.press('ControlOrMeta+b');
const italic = (page: Page) => page.keyboard.press('ControlOrMeta+i');
const struck = (page: Page) => page.keyboard.press('ControlOrMeta+Shift+X');
const code = (page: Page) => page.keyboard.press('ControlOrMeta+e');

/** A fresh copy of the document, the caret at the end of `plain`. */
async function atEndOfPlain(ep: EditorPage, page: Page): Promise<void> {
	await nextRow(ep, DOC);
	await clickBlockSettled(ep, PLAIN);
	await page.keyboard.press('End');
	await ep.waitForRenderFlush();
}

test('live mode: a pended mark rides the next insertion', async ({ page }) => {
	const ep = await enterLive(page);

	await test.step('Mod+B then a keystroke writes a wrapped byte that renders bold', async () => {
		await atEndOfPlain(ep, page);

		await bold(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('plain**X**');

		await expect(page.locator('.text-editable-block strong').first()).toHaveText('X');
	});

	await test.step('Mod+B then Mod+I put both marks on one insertion', async () => {
		await atEndOfPlain(ep, page);

		await bold(page);
		await italic(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('plain***X***');
	});

	// `Some **bold** text`: `bold` is [7,11). Toggling a mark the text already has removes it, so
	// the byte escapes the construct rather than nesting a second pair inside it.
	await test.step('a mark pended inside bold unbolds the next insertion', async () => {
		await nextRow(ep, DOC);
		await clickWordSettled(ep, page, 'bold');
		await stepTo(ep, page, 'ArrowRight', 9);

		await bold(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some **bo**X**ld** text');
	});

	// An abandoned toggle must leave no bytes: `****` would change the text with nothing on screen
	// to explain it.
	await test.step('Mod+B then a click away leaves the bytes untouched', async () => {
		await atEndOfPlain(ep, page);

		const before = await ep.bridge.getSource();
		await bold(page);
		await clickBlockSettled(ep, BOLD);
		// A click away from the pending mark, not a keystroke.
		await ep.waitForNoSourceMutation();

		expect(await ep.bridge.getSource()).toBe(before);
	});

	// A host placing the caret moves it as surely as a click does, so the promise is dropped.
	await test.step('Mod+B then a host setSelection: the next keystroke types plain', async () => {
		await atEndOfPlain(ep, page);

		await bold(page);
		const caret = { path: [BOLD], offset: 0 };
		expect(await ep.bridge.setSelection({ anchor: caret, focus: caret })).toBe(true);
		await ep.waitForRenderFlush();
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('XSome **bold** text');

		expect(await ep.bridge.getSource()).not.toContain('**X**');
	});
});

// The two chords no other scenario uses. The nesting rows check that the order comes from the mark
// table: the wrong order wraps literal stars in a code span, which the resolver would decline.
test('live mode: the marks beyond bold and italic', async ({ page }) => {
	const ep = await enterLive(page);

	/** Between the two spaces of `gap  here`, reached by real keypresses from the line start. */
	const atGap = async (): Promise<void> => {
		await nextRow(ep, DOC);
		await clickBlockSettled(ep, GAP);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowRight', 4);
	};

	await test.step('Mod+Shift+X then a keystroke writes a struck byte', async () => {
		await atEndOfPlain(ep, page);
		await struck(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('plain~~X~~');

		await expect(page.locator('.text-editable-block s').first()).toHaveText('X');
	});

	await test.step('Mod+E then a keystroke writes a code byte', async () => {
		await atEndOfPlain(ep, page);
		await code(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('plain`X`');

		await expect(page.locator('.text-editable-block code').first()).toHaveText('X');
	});

	await test.step('Mod+B then Mod+E nests the code span inside the strong', async () => {
		await atGap();
		await bold(page);
		await code(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('gap **`X`** here');
	});

	await test.step('Mod+E then Mod+B writes the same bytes, so the order is the table’s', async () => {
		await atGap();
		await code(page);
		await bold(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('gap **`X`** here');
	});

	// `~~struck~~ tail`: content is [2,8), so offset 4 sits after `st`. The same close-and-reopen
	// escape bold takes, on the run whose delimiters are two bytes rather than two asterisks.
	await test.step('a mark pended inside a struck phrase splits it open', async () => {
		// Home lands past the hidden opener, so the steps are counted from the content start.
		await nextRow(ep, DOC);
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

// A bold phrase split at the space: `**hello**X** world**` renders `helloX** world**`, since a
// closing run before a space is not left-flanking, so the resolver steps outside the construct.
test('live mode: un-bolding at the space inside a bold phrase never surfaces a delimiter', async ({
	page
}) => {
	const ep = await enterLive(page);
	await clickWordSettled(ep, page, 'hello');
	await stepTo(ep, page, 'ArrowRight', 7);

	await bold(page);
	await page.keyboard.type('X');
	await ep.bridge.waitForSourceContains('X**hello world**');

	// What the user sees: one plain X, and a phrase that is still entirely bold.
	const block = ep.getBlock(PHRASE);
	await expect(block).toHaveText('Xhello world', { useInnerText: true });
	await expect(block.locator('strong')).toHaveText('hello world', { useInnerText: true });
	await expect(block.locator('.md-marker').first()).toHaveCSS('display', 'none');
});

// An autolink is one span with no children, so a mark inside the URL would destroy the link and
// paint its brackets; the mark declines and the byte types plain.
test('live mode: Mod+B inside an autolink’s URL types plain and leaves the link intact', async ({
	page
}) => {
	const ep = await enterLive(page);
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

test('live mode: a mark is spent once and cleared by any caret move', async ({ page }) => {
	const ep = await enterLive(page);

	// Spent once, but the caret it left is inside the pair it made, so the next byte extends that
	// construct by the ordinary arrival rule rather than by a second mark.
	await test.step('the second keystroke extends what the first one made, not a second pair', async () => {
		await atEndOfPlain(ep, page);

		await bold(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('plain**X**');

		// Waited for first: the mark's commit re-renders the block and restores the caret, and a
		// second byte racing that restore says nothing about whether the mark was spent.
		await page.keyboard.type('Y');
		await ep.bridge.waitForSourceContains('plain**XY**');
	});

	await test.step('an arrow step drops the mark', async () => {
		await atEndOfPlain(ep, page);

		await bold(page);
		await page.keyboard.press('ArrowLeft');
		await ep.waitForRenderFlush();
		await page.keyboard.type('X');

		await ep.bridge.waitForSourceContains('plaiXn');
		await ep.bridge.waitForSourceNotContains('plai**');
	});

	await test.step('a click drops the mark', async () => {
		await atEndOfPlain(ep, page);

		await bold(page);
		await clickWordSettled(ep, page, 'plain');
		const at = await focusOffset(ep);
		await page.keyboard.type('X');

		const typed = `${'plain'.slice(0, at)}X${'plain'.slice(at)}`;
		await ep.bridge.waitForSource((source) => source.startsWith(`${typed}\n`));
	});
});

// Emptying the construct a mark just made unwraps it; the preview modes keep the empty pair, and
// the keypress hands the mark back so live agrees and the next byte is still italic.
test('live mode: a press that empties a construct hands its mark back', async ({ page }) => {
	const ep = await enterLive(page);
	const emptied = async () => {
		await atEndOfPlain(ep, page);

		await italic(page);
		await page.keyboard.type('x');
		await ep.bridge.waitForSourceContains('plain*x*');

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceNotContains('*x*');
		await ep.waitForRenderFlush();
	};

	await test.step('the second chord turns the mark off, so the next byte types plain', async () => {
		await emptied();
		await italic(page);
		await page.keyboard.type('y');

		await ep.bridge.waitForSourceContains('plainy');
		await ep.bridge.waitForSourceNotContains('*y*');
	});

	await test.step('with no second chord the next byte is still italic', async () => {
		await emptied();
		await page.keyboard.type('y');

		await ep.bridge.waitForSourceContains('plain*y*');
		await expect(ep.getBlock(PLAIN).locator('em')).toHaveText('y');
	});
});

// The toggle flushes the keystroke batch, so the insertion that spends it owns its own undo entry
// rather than coalescing with the words typed before it.
test('live mode: one Mod+Z after a burst, a toggle and a keystroke returns the burst', async ({
	page
}) => {
	const ep = await enterLive(page);
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

test('live mode: an IME commit after Mod+B lands wrapped, like a keystroke', async ({ page }) => {
	const ep = await enterLive(page);
	await clickBlockSettled(ep, PLAIN);
	await page.keyboard.press('End');
	await ep.waitForRenderFlush();

	await bold(page);
	const ime = await attachIme(page);
	await ime.compose('か');
	await ime.commit('かん');

	await ep.bridge.waitForSourceContains('plain**かん**');
});

// The dispatcher runs `handlePendingMarks` before `handleCstWidget`, so these rows check that a
// splice that would change painted text is declined and the widget survives whole.
test('live mode: a pending mark beside an inline widget', async ({ page }) => {
	const WIDGET_DOC = 'see &amp; now\n';
	const ep = await enterPresentationMode(page, 'live', WIDGET_DOC);

	await test.step('the byte lands before the widget, wrapped, and the entity survives', async () => {
		await nextRow(ep, WIDGET_DOC);
		await ep.waitForRenderFlush();

		await ep.focusBlock(0, 4);
		await bold(page);
		await ep.waitForRenderFlush();
		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');

		expect(await ep.bridge.getSource()).toBe('see **Z**&amp; now\n');
	});

	await test.step('the byte lands after the widget the same way', async () => {
		await nextRow(ep, WIDGET_DOC);
		await ep.waitForRenderFlush();

		// Stepped rather than placed directly: the widget is one atomic stop, so five keypresses
		// from the line start clear it, and a DOM offset cannot address the far side of a widget.
		await ep.clickBlock(0);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
		await ep.waitForRenderFlush();
		await bold(page);
		await ep.waitForRenderFlush();
		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');

		expect(await ep.bridge.getSource()).toBe('see &amp;**Z** now\n');
	});
});
