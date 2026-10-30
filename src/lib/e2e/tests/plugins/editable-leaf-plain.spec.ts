import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { roundTripStable, waitForDoc, activeBlockPath } from './helpers';
import { MemoPage } from './memo-helpers';
import { insertText } from '../../insert-text';
import { edgeKey, extendKey } from '../../platform-keys';
import { attachIme } from '../../simulation/ime';

/**
 * A plain-mode editable leaf (requirements/plugins/editable-leaf-plain.md): the `%%` memo harness
 * kind proves `createEditableLeaf({ mode: 'plain' })` gives a plugin block everything a built-in
 * text block has, through the public factory alone: typing, moving the caret, undo batching,
 * cross-block selection and the clipboard.
 */

const FAMILY = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);

/** A soft keyboard's Backspace: the `beforeinput` alone, no keydown. */
async function sendKeylessBackspace(page: Page): Promise<void> {
	await page.evaluate(() => {
		document.activeElement!.dispatchEvent(
			new InputEvent('beforeinput', {
				inputType: 'deleteContentBackward',
				bubbles: true,
				cancelable: true
			})
		);
	});
}

test.describe('plain-mode editable leaf: the %% memo kind', () => {
	let editor: MemoPage;

	test.beforeEach(async ({ page }) => {
		editor = new MemoPage(page);
		await editor.gotoSeed();
	});

	test('typing commits per keystroke and round-trips', async ({ page }) => {
		await editor.memo.click();
		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.type('!');

		await editor.bridge.waitForSourceContains('%% memo text!');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('arrows enter, cross, and exit the memo like a native block', async ({ page }) => {
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowRight');
		expect(await activeBlockPath(page)).toEqual([1]);

		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.press('ArrowRight');
		expect(await activeBlockPath(page)).toEqual([2]);

		await page.keyboard.press('ArrowUp');
		expect(await activeBlockPath(page)).toEqual([1]);
		await page.keyboard.press('ArrowUp');
		expect(await activeBlockPath(page)).toEqual([0]);
	});

	test('a typed burst undoes in one step (prose-like batching)', async ({ page }) => {
		await editor.memo.click();
		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.type(' abc');
		await editor.bridge.waitForSourceContains('%% memo text abc');

		await editor.undo();
		await editor.bridge.waitForSourceNotContains('abc');
		expect(await editor.bridge.getSource()).toContain('%% memo text');
	});

	// The editor writes the delete, so a soft keyboard's (the `beforeinput` alone) takes what the
	// key takes.
	for (const route of ['key', 'soft keyboard'] as const) {
		test(`Backspace by ${route} takes an emoji whole`, async ({ page }) => {
			await editor.memo.click();
			await page.keyboard.press(edgeKey('lineEnd'));
			await insertText(page, FAMILY);
			await editor.bridge.waitForSourceContains(`%% memo text${FAMILY}`);

			if (route === 'key') await page.keyboard.press('Backspace');
			else await sendKeylessBackspace(page);
			await page.keyboard.type('z');
			await editor.bridge.waitForSourceContains('%% memo textz');
		});
	}

	test('a cross-block selection sweeps through the memo', async ({ page }) => {
		await editor.focusBlockEnd(0);
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Shift+ArrowDown');

		await page.waitForFunction(() => {
			const paths = (window as unknown as Record<string, any>).__test.getSelectionPaths();
			return paths?.focus?.path?.[0] === 2;
		});
		const paths = await editor.bridge.getSelectionPaths();
		expect(paths!.anchor.path).toEqual([0]);
		expect(paths!.focus.path).toEqual([2]);
	});

	test('a character typed over a range ending in the memo replaces the range', async ({ page }) => {
		await editor.memo.click();
		await page.keyboard.press(edgeKey('lineStart'));
		await page.keyboard.press('Shift+ArrowUp');
		await editor.waitForCrossBlock(true);
		expect(await activeBlockPath(page)).toEqual([1]);

		await page.keyboard.type('x');

		// The range ends at the memo's first byte, so the memo stays whole and the character
		// replaces only the text before it.
		await editor.waitForCrossBlock(false);
		await expect.poll(() => editor.bridge.getSource()).toBe('x\n\n%% memo text\n\nAfter\n');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('Enter + text re-splits the memo through the commit core', async ({ page }) => {
		await editor.memo.click();
		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.press('Enter');
		await page.keyboard.type('tail');

		const doc = await waitForDoc(page, (s) => s.rootCount === 4);
		expect(doc.kinds).toEqual(['paragraph', 'memo', 'paragraph', 'paragraph']);
		expect(doc.texts[1]).toBe('%% memo text');
		expect(doc.texts[2]).toBe('tail');
		// The caret followed the edit into the split-off paragraph.
		expect(await activeBlockPath(page)).toEqual([2]);
		expect(await roundTripStable(page)).toBe(true);
	});

	test('a single-block paste is intercepted: HTML is stripped and newlines survive', async ({
		page
	}) => {
		await editor.memo.click();
		await page.keyboard.press(edgeKey('lineEnd'));
		await editor.seedClipboard({ 'text/plain': 'a\nb', 'text/html': '<b>a</b><br><i>b</i>' });
		await editor.paste();

		// The text/plain payload lands verbatim, its newline splitting off a paragraph; without the
		// leaf's own onpaste, HTML markup would land and the commit would join the lines.
		await editor.bridge.waitForSourceContains('%% memo texta\nb');
		const html = await page.evaluate(() => document.querySelector('.memo-block')?.innerHTML ?? '');
		expect(html).not.toContain('<b>');
		expect(html).not.toContain('<i>');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('cross-block copy anchored in the memo reaches the shared collector', async ({ page }) => {
		await editor.memo.click();
		await page.keyboard.press(edgeKey('lineStart'));
		await page.keyboard.press(extendKey('lineEnd')); // select the memo line (single-block, native)
		await page.keyboard.press('Shift+ArrowDown'); // extend into After → cross-block
		await editor.waitForCrossBlock(true);
		await editor.seedClipboard('SENTINEL');
		await page.keyboard.press('ControlOrMeta+c');

		// The memo block holds the focus, so its copy handler must reach the shared cross-block
		// collector, which reads the memo's own raw. Without one the clipboard keeps its marker.
		await expect.poll(() => editor.readClipboard()).toContain('memo text');
	});

	test('cross-block cut anchored in the memo writes the payload and collapses the range', async ({
		page
	}) => {
		await editor.memo.click();
		await page.keyboard.press(edgeKey('lineStart'));
		await page.keyboard.press(extendKey('lineEnd'));
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.seedClipboard('SENTINEL');
		await page.keyboard.press('ControlOrMeta+x');

		// The leaf's cut handler writes the cross-block payload and deletes the selected range; if
		// no handler is reached, the clipboard keeps its marker and nothing is removed.
		await expect.poll(() => editor.readClipboard()).toContain('memo text');
		await editor.waitForCrossBlock(false);
		expect(await roundTripStable(page)).toBe(true);
	});

	// memo registers no paste handling, so the dispatch takes the default hooks and reports that;
	// declaring it is what makes the fallthrough an asserted path rather than an assumption.
	test.describe('paste over a cross-block selection anchored in the memo', () => {
		test.use({ expectWarns: ['paste-dispatch'] });

		test('clears it and lands the text', async ({ page }) => {
			await editor.memo.click();
			await page.keyboard.press(edgeKey('lineEnd'));
			await page.keyboard.press('Shift+ArrowDown');
			await editor.waitForCrossBlock(true);
			await editor.seedClipboard('INSERTED');
			await editor.paste();

			// The leaf's paste handler sends the range through the cross-block delete and paste, so the
			// selection collapses and the text lands; unreached, the cross-block state sticks.
			await editor.waitForCrossBlock(false);
			await editor.bridge.waitForSourceContains('INSERTED');
			expect(await roundTripStable(page)).toBe(true);
		});
	});
});

// Every composition host keeps the same rules (`ime-hosts.spec.ts` for the built-in ones); each
// row compares against the same gesture with the text typed instead.
test.describe('plain-mode editable leaf: IME composition', () => {
	let editor: MemoPage;
	let seed: string;

	test.beforeEach(async ({ page }) => {
		editor = new MemoPage(page);
		await editor.gotoSeed();
		seed = await editor.bridge.getSource();
	});

	async function atMemoEnd(page: Page): Promise<void> {
		await editor.loadContent(seed);
		await editor.memo.click();
		await page.keyboard.press(edgeKey('lineEnd'));
	}

	test.describe('a composition the browser drops, then Enter', () => {
		test.use({ expectWarns: ['composition'] });
		// The CDP composition owns a key pressed inside it; the hand-fired IME drops at any key.
		test.skip(({ browserName }) => browserName === 'chromium', 'Chromium drops only after a <br>');

		test('saves the text once, and Enter acts as after typing it', async ({ page }) => {
			const run = async (enter: () => Promise<void>) => {
				await atMemoEnd(page);
				await enter();
				await page.keyboard.press('Enter');
				await editor.typeSlowly('Q');
				await editor.bridge.waitForSourceContains('Q');
				return editor.bridge.getSource();
			};
			const typed = await run(() => insertText(page, 'か'));
			const ime = await attachIme(page);
			expect(await run(() => ime.compose('か'))).toBe(typed);
		});
	});

	test('a composition over a range anchored in the memo lands in it, as typing does', async ({
		page
	}) => {
		const over = async (put: () => Promise<void>) => {
			await atMemoEnd(page);
			await page.keyboard.press('Shift+ArrowDown');
			await editor.waitForCrossBlock(true);
			await put();
			await editor.bridge.waitForSourceContains('漢');
			return editor.bridge.getSource();
		};
		const typed = await over(() => insertText(page, '漢'));
		const ime = await attachIme(page);
		const composed = await over(async () => {
			await ime.compose('かん');
			await ime.commit('漢');
		});
		expect(composed).toBe(typed);
		expect(composed).toContain('%% memo text漢');
	});
});
