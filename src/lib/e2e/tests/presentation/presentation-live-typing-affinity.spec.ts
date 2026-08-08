import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { centerOfWord } from './helpers';

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
	'next'
].join('\n');

const BOLD = 0;
const LINK = 1;
const ESCAPE = 2;
const HARD_BREAK = 3;

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
