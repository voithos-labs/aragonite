import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { primaryModifier } from '../../platform';
import { centerOfWord } from './helpers';
import { attachIme } from '../../simulation/ime';

// A collapsed-caret toggle in live mode writes no bytes; the next insertion carries the mark.
// The source is the oracle — live paints no delimiter, so nothing on screen distinguishes a
// pended mark from an empty pair until bytes exist.
// Requirements: e2e/requirements/presentation/presentation-live-pending-marks.md.

const DOC = ['plain', '', 'Some **bold** text'].join('\n');

const PLAIN = 0;
const BOLD = 1;

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

/** A click's caret is what every scenario starts from, and the bridge reporting NO selection is
 *  the shape a lost click takes — so settle on the caret existing rather than on the click. */
async function settleCaret(ep: EditorPage): Promise<void> {
	await expect.poll(() => focusOffset(ep), { timeout: 2000 }).toBeGreaterThanOrEqual(0);
}

async function clickBlock(ep: EditorPage, index: number): Promise<void> {
	await ep.clickBlock(index);
	await settleCaret(ep);
}

async function clickWord(ep: EditorPage, page: Page, word: string): Promise<void> {
	const point = await centerOfWord(page, word);
	await page.mouse.click(point.x, point.y);
	await ep.waitForRenderFlush();
	await settleCaret(ep);
}

/** Step with `key` until the caret reports `target` — the arrival is a real gesture, never a
 *  programmatic seat. */
async function stepTo(ep: EditorPage, page: Page, key: string, target: number): Promise<void> {
	for (let i = 0; i < 12; i++) {
		if ((await focusOffset(ep)) === target) return;
		await page.keyboard.press(key);
		await ep.waitForRenderFlush();
	}
	throw new Error(`stepTo: ${key} never reached offset ${target} (at ${await focusOffset(ep)})`);
}

const bold = (page: Page) => page.keyboard.press(`${primaryModifier}+b`);
const italic = (page: Page) => page.keyboard.press(`${primaryModifier}+i`);

test.describe('live mode — a pended mark rides the next insertion', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	test('Mod+B then a keystroke writes a wrapped byte that renders bold', async ({ page }) => {
		await clickBlock(ep, PLAIN);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();

		await bold(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('plain**X**');

		await expect(page.locator('.text-editable-block strong').first()).toHaveText('X');
	});

	test('Mod+B then Mod+I put both marks on one insertion', async ({ page }) => {
		await clickBlock(ep, PLAIN);
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
		await clickWord(ep, page, 'bold');
		await stepTo(ep, page, 'ArrowRight', 9);

		await bold(page);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some **bo**X**ld** text');
	});

	// The whole reason the byte-pair strategy cannot ship in live: an abandoned toggle would
	// leave `****` the user can see the effect of but never explain.
	test('Mod+B then a click away leaves the bytes untouched', async ({ page }) => {
		await clickBlock(ep, PLAIN);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();

		const before = await ep.bridge.getSource();
		await bold(page);
		await clickBlock(ep, BOLD);
		await ep.waitForNoSourceMutation();

		expect(await ep.bridge.getSource()).toBe(before);
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
		await clickBlock(ep, PLAIN);
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
		await clickBlock(ep, PLAIN);
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
		await clickBlock(ep, PLAIN);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();

		await bold(page);
		await clickWord(ep, page, 'plain');
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

	// A toggle mid-burst used to coalesce into the surrounding keystroke batch, so one Ctrl+Z
	// took the formatting AND the words that preceded it.
	test('one Mod+Z after a burst, a toggle and a keystroke returns the burst', async ({ page }) => {
		await clickBlock(ep, PLAIN);
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
		await clickBlock(ep, PLAIN);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();

		await bold(page);
		const ime = await attachIme(page);
		await ime.compose('か');
		await ime.commit('かん');

		await ep.bridge.waitForSourceContains('plain**かん**');
	});
});
