import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { primaryModifier } from '../../platform';

// #107: a format toggle over a cross-block range fell through to the type-replace arm, which
// deleted the range and then materialized an empty pair at the collapsed caret — the document
// became `****`, and undo left `\n`. The toggle declines instead: consumed, nothing written.
// The sibling that stays live is plain typing over the same range, pinned at the bottom.

const DOC = 'First block here\n\nSecond block here\n\nThird block here\n';

const CHORDS = ['b', 'i', 'e'] as const;

async function selectWholeDocument(ep: EditorPage, page: Page): Promise<void> {
	await ep.focusBlock(0, 3);
	await page.keyboard.press(`${primaryModifier}+a`);
	await page.keyboard.press(`${primaryModifier}+a`);
	await ep.waitForCrossBlock(true);
}

for (const mode of ['source', 'live', 'preview-inline'] as const) {
	test.describe(`cross-block format toggle declines — ${mode}`, () => {
		let ep: EditorPage;

		test.beforeEach(async ({ page }) => {
			ep = new EditorPage(page);
			await ep.goto(mode === 'source' ? '' : `?presentationMode=${mode}`);
			await ep.loadContent(DOC);
			await ep.waitForRenderFlush();
		});

		for (const key of CHORDS) {
			test(`Mod+${key.toUpperCase()} over the whole document writes nothing`, async ({ page }) => {
				const before = await ep.bridge.getSource();
				await selectWholeDocument(ep, page);
				await page.keyboard.press(`${primaryModifier}+${key}`);
				await ep.waitForRenderFlush();
				await ep.waitForNoSourceMutation();
				expect(await ep.bridge.getSource()).toBe(before);
			});
		}

		test('Mod+Shift+X over the whole document writes nothing', async ({ page }) => {
			const before = await ep.bridge.getSource();
			await selectWholeDocument(ep, page);
			await page.keyboard.press(`${primaryModifier}+Shift+X`);
			await ep.waitForRenderFlush();
			await ep.waitForNoSourceMutation();
			expect(await ep.bridge.getSource()).toBe(before);
		});

		test('the declined chord is consumed and adds no undo entry', async ({ page }) => {
			const before = await ep.bridge.getSource();
			await selectWholeDocument(ep, page);
			// A document-level BUBBLE listener runs after the block's own handler, so it reads
			// the flag that handler set — the receipt a claimed chord leaves behind. NOT
			// `once`: the modifier's own keydown arrives first and would spend the listener.
			await page.evaluate(() => {
				(window as any).__chordPrevented = null;
				document.addEventListener('keydown', (e) => {
					if (e.key === 'b' || e.key === 'B') (window as any).__chordPrevented = e.defaultPrevented;
				});
			});
			await page.keyboard.press(`${primaryModifier}+b`);
			await ep.waitForRenderFlush();
			expect(await page.evaluate(() => (window as any).__chordPrevented)).toBe(true);

			// One undo must not walk past the load: the decline pushed no entry.
			await ep.undo();
			await ep.waitForNoSourceMutation();
			expect(await ep.bridge.getSource()).toBe(before);
		});
	});
}

test.describe('the sibling that stays live — cross-block type-replace', () => {
	test('plain typing over the range still replaces it in ONE undo entry', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(DOC);
		await ep.waitForRenderFlush();
		const before = await ep.bridge.getSource();

		await selectWholeDocument(ep, page);
		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).not.toContain('First block');

		await ep.undo();
		await ep.bridge.waitForSourceEquals(before, 3000);
	});
});
