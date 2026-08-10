import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { centerOfWord, trailingEdgeOfWord } from './helpers';
import { attachIme } from '../../simulation/ime';

// Which side of a hidden delimiter run a typed byte lands on. The source is the oracle: the
// caret reports the same offset either way, so only the bytes distinguish the two seats.
// Requirements: e2e/requirements/presentation/presentation-live-typing-affinity.md.

const DOC = [
	'Some **bold** text',
	'',
	'A [link](https://example.com) tail',
	'',
	'x \\* y',
	'',
	'end  ',
	'next',
	'',
	'**Lead** in'
].join('\n');

const BOLD = 0;
const LINK = 1;
const ESCAPE = 2;
const HARD_BREAK = 3;
const LEAD = 4;

async function enterLive(page: Page): Promise<EditorPage> {
	const ep = new EditorPage(page);
	await ep.goto('?presentationMode=live');
	await ep.loadContent(DOC);
	await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'live');
	return ep;
}

async function focusOffset(ep: EditorPage): Promise<number> {
	return (await ep.bridge.getSelectionPaths())?.focus.offset ?? -1;
}

/** Step with `key` until the caret reports `target`. The arrival that lands there is the
 *  seat's input, so every scenario reaches its edge by real stepping. */
async function stepTo(ep: EditorPage, page: Page, key: string, target: number): Promise<void> {
	for (let i = 0; i < 12; i++) {
		if ((await focusOffset(ep)) === target) return;
		await page.keyboard.press(key);
		await ep.waitForRenderFlush();
	}
	throw new Error(`stepTo: ${key} never reached offset ${target} (at ${await focusOffset(ep)})`);
}

async function clickWord(ep: EditorPage, page: Page, word: string): Promise<void> {
	const point = await centerOfWord(page, word);
	await page.mouse.click(point.x, point.y);
	await ep.waitForRenderFlush();
	await settleCaret(ep);
}

async function clickBlock(ep: EditorPage, index: number): Promise<void> {
	await ep.clickBlock(index);
	await settleCaret(ep);
}

/** A click's caret is what every scenario steps from, and the bridge reporting NO selection
 *  is the shape a lost click takes — so settle on the caret existing rather than on the click
 *  returning, or the first `stepTo` reports a bare -1 and says nothing about why. */
async function settleCaret(ep: EditorPage): Promise<void> {
	await expect.poll(() => focusOffset(ep), { timeout: 2000 }).toBeGreaterThanOrEqual(0);
}

test.describe('live mode — a symmetric pair extends by arrival', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	// `Some **bold** text`: strong is [5,13), `bold` [7,11). Rightward arrival stops on the
	// content side, so the byte belongs to the construct — and so does the one after it.
	test('typing at bold’s trailing content edge extends it, and keeps extending', async ({
		page
	}) => {
		await clickWord(ep, page, 'bold');
		await stepTo(ep, page, 'ArrowRight', 11);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some **boldX** text');

		await page.keyboard.type('Y');
		await ep.bridge.waitForSourceContains('Some **boldXY** text');
	});

	// The same screen position, reached leftward across the whole closing run: the caret came
	// from outside the construct and has not entered it, so the byte lands past the `**`.
	test('a caret that arrived at bold’s trailing edge from outside types past it', async ({
		page
	}) => {
		await clickBlock(ep, BOLD);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowLeft', 11);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some **bold**X text');
	});

	// Leading edge, mirrored: one leftward press out of `bold` reaches the shared pixel but
	// has not left the construct, so the byte stays inside it.
	test('a caret that stepped left out of bold’s leading edge still types inside', async ({
		page
	}) => {
		await clickWord(ep, page, 'bold');
		await stepTo(ep, page, 'ArrowLeft', 5);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some **Xbold** text');
	});

	test('a caret that stepped right up to bold’s leading edge types before it', async ({ page }) => {
		await clickBlock(ep, BOLD);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowRight', 5);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some X**bold** text');
	});

	// A line extreme is construct-relative, not directional: `Home` on a line that OPENS with
	// a pair means before its opener, the opposite walk-order side from `End` after a closer.
	test('Home on a line opening with bold types before the construct', async ({ page }) => {
		await clickBlock(ep, LEAD);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		expect(await focusOffset(ep)).toBe(2);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('X**Lead** in');
	});

	// A click clears the arrival, so the seat's own default IS the click contract: the
	// construct the caret touches keeps the byte (live-mode.md § 4.2, the gdocs default).
	test('a click at bold’s trailing content edge extends it', async ({ page }) => {
		const point = await trailingEdgeOfWord(page, 'bold');
		await page.mouse.click(point.x, point.y);
		await ep.waitForRenderFlush();
		await settleCaret(ep);
		expect(await focusOffset(ep)).toBe(11);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some **boldX** text');
	});
});

test.describe('live mode — a never-extend construct ignores the arrival', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	// `A [link](https://example.com) tail`: the link is [2,29), `link` [3,7). Both arrivals
	// that would extend a symmetric pair put the byte past the closing `)`.
	test('a link’s trailing content edge never extends, whichever arrival seated the caret', async ({
		page
	}) => {
		await clickWord(ep, page, 'link');
		await stepTo(ep, page, 'ArrowRight', 7);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('A [link](https://example.com)X tail');

		await clickBlock(ep, LINK);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowLeft', 7);
		await page.keyboard.type('Y');
		await ep.bridge.waitForSourceContains('A [link](https://example.com)YX tail');
	});

	test('a link’s leading content edge never extends either', async ({ page }) => {
		await clickWord(ep, page, 'link');
		await stepTo(ep, page, 'ArrowLeft', 2);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('A X[link](https://example.com) tail');
	});
});

test.describe('live mode — unstamped marker runs are never typed into', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	// `x \* y`: the backslash is unpainted, the `*` is the glyph. Neither side of the pair
	// admits a byte between them.
	test('an escape’s two bytes stay adjacent whichever side is typed at', async ({ page }) => {
		await clickBlock(ep, ESCAPE);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowRight', 2);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('x X\\* y');

		await stepTo(ep, page, 'ArrowRight', 5);
		await page.keyboard.type('Y');
		await ep.bridge.waitForSourceContains('x X\\*Y y');
	});

	// `end  \nnext`: the two spaces before the newline are the break's markers.
	test('a hard break’s trailing spaces survive a byte typed at the line end', async ({ page }) => {
		await clickBlock(ep, HARD_BREAK);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowLeft', 3);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('endX  \nnext');
	});
});

// A construct with no CHILDREN — a line-leading escape, an angle autolink — has no content range
// for the seat to split on, yet the landable floor puts the caret against its run legitimately:
// a click at a line's left edge clears the leading hidden run, which is INSIDE a construct that
// is all delimiters, so the seat must still answer there.
const CHILDLESS_DOC = [
	'\\*Lead in',
	'',
	'<https://example.com> tail',
	'',
	'tail then <https://example.com>',
	'',
	'**Bold** in'
].join('\n');

const ESCAPE_LEAD = 0;
const AUTOLINK_LEAD = 1;
const AUTOLINK_TAIL = 2;
const BOLD_LEAD = 3;

test.describe('live mode — a childless construct is all delimiters', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = new EditorPage(page);
		await ep.goto('?presentationMode=live');
		await ep.loadContent(CHILDLESS_DOC);
		await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'live');
	});

	test('a click at the left edge of an escaped line types before the backslash', async ({
		page
	}) => {
		await clickBlock(ep, ESCAPE_LEAD);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		// Not `\Z*Lead`, which puts the backslash on screen.
		expect(await ep.bridge.getSource()).toContain('Z\\*Lead in');
	});

	test('Home on a line opening with an autolink types before its bracket', async ({ page }) => {
		await clickBlock(ep, AUTOLINK_LEAD);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('Z<https://example.com> tail');
	});

	// The softer sibling: the caret seats at the landable end, which is INSIDE the closing
	// bracket, and a byte there rewrites where the link goes. A link never extends at either
	// edge (live-mode.md § 4.2), and the angle form is a link.
	test('End after a trailing autolink types past its closing bracket', async ({ page }) => {
		await clickBlock(ep, AUTOLINK_TAIL);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('<https://example.com>Z');
	});

	// The discriminating twin: the bold control was correct throughout, so a fix that moved the
	// symmetric pair too would show up here.
	test('the bold control is unchanged by the same gesture', async ({ page }) => {
		await clickBlock(ep, BOLD_LEAD);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('Z**Bold** in');
	});
});

// The IME half of the same contract: `insertCompositionText` is not cancelable, so the composed
// run is relocated on the commit compositionend drives — one commit, one undo entry.
test.describe('live mode — an IME commit takes the same seat as a keystroke', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	test('a composition at a link’s trailing content edge commits past the closer', async ({
		page
	}) => {
		await clickWord(ep, page, 'link');
		await stepTo(ep, page, 'ArrowRight', 7);

		const ime = await attachIme(page);
		await ime.compose('か');
		await ime.commit('かん');
		await ep.bridge.waitForSourceContains('A [link](https://example.com)かん tail');
	});

	test('a composition at bold’s trailing edge extends it when the arrival was from inside', async ({
		page
	}) => {
		await clickWord(ep, page, 'bold');
		await stepTo(ep, page, 'ArrowRight', 11);

		const ime = await attachIme(page);
		await ime.compose('か');
		await ime.commit('かん');
		await ep.bridge.waitForSourceContains('Some **boldかん** text');
	});

	test('a composition at bold’s trailing edge arrived from outside commits past it', async ({
		page
	}) => {
		await clickBlock(ep, BOLD);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowLeft', 11);

		const ime = await attachIme(page);
		await ime.compose('か');
		await ime.commit('かん');
		await ep.bridge.waitForSourceContains('Some **bold**かん text');
	});
});
