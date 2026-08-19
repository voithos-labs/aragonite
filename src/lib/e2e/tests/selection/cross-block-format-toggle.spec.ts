import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickWordSettled, landAt } from '../presentation/helpers';

// #107: a format toggle over a cross-block range fell through to the type-replace arm, which
// deleted the range and then materialized an empty pair at the collapsed caret — the document
// became `****`, and undo left `\n`. The toggle declines instead: consumed, nothing written.
// The sibling that stays live is plain typing over the same range, pinned at the bottom.

const DOC = 'First block here\n\nSecond block here\n\nThird block here\n';

// The chord as pressed beside the name it goes by: `Shift+X` is one press, not a key letter.
const CHORDS = [
	{ key: 'b', name: 'Mod+B' },
	{ key: 'i', name: 'Mod+I' },
	{ key: 'e', name: 'Mod+E' },
	{ key: 'Shift+X', name: 'Mod+Shift+X' }
] as const;

async function selectWholeDocument(ep: EditorPage, page: Page): Promise<void> {
	await ep.focusBlock(0, 3);
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('ControlOrMeta+a');
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

		for (const { key, name } of CHORDS) {
			test(`${name} over the whole document writes nothing`, async ({ page }) => {
				const before = await ep.bridge.getSource();
				await selectWholeDocument(ep, page);
				await page.keyboard.press(`ControlOrMeta+${key}`);
				await ep.waitForRenderFlush();
				await ep.waitForNoSourceMutation();
				expect(await ep.bridge.getSource()).toBe(before);
			});
		}

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
			await page.keyboard.press('ControlOrMeta+b');
			await ep.waitForRenderFlush();
			expect(await page.evaluate(() => (window as any).__chordPrevented)).toBe(true);

			// One undo must not walk past the load: the decline pushed no entry.
			await ep.undo();
			await ep.waitForNoSourceMutation();
			expect(await ep.bridge.getSource()).toBe(before);
		});
	});
}

test.describe('the rebound chord — the only gesture that reaches the seam with a range painted', () => {
	// Every default toggle chord is swallowed a layer earlier, so a leaf handing the seam a
	// constant `isCrossBlockRange: () => false` would still pass every case above. A chord the
	// swallow does not know walks the block's own dispatch, where the leaf's live flag is the
	// only thing between the press and a single-block rewrite of the anchor block.
	test('Mod+Alt+G bound to the strong toggle writes nothing and commits no edit', async ({
		page
	}) => {
		const ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(DOC);
		await ep.waitForRenderFlush();
		await page.evaluate(() =>
			(window as any).__test.setKeybindings([
				{ chord: 'Mod+Alt+G', command: 'format.toggleStrong' }
			])
		);
		const before = await ep.bridge.getSource();
		await selectWholeDocument(ep, page);

		// The edit counter, not an undo round-trip: undo-then-compare restores the pair a
		// leaked toggle would have written, so it passes either way.
		await page.evaluate(() => (window as any).__test.startEditOpCapture());
		await page.keyboard.press('ControlOrMeta+Alt+g');
		await ep.waitForRenderFlush();
		await ep.waitForNoSourceMutation();

		expect(await page.evaluate(() => (window as any).__test.stopEditOpCapture().length)).toBe(0);
		expect(await ep.bridge.getSource()).toBe(before);
	});
});

test.describe('the sibling chord the sweep missed — Mod+K over a cross-block range', () => {
	// The cross-block entry parks a COLLAPSED native caret at the anchor, so the link-card
	// entry's native-collapse check alone reads a painted range as an ordinary caret.
	const LINKED = 'Visit [example](https://example.com) now\n\nSecond block here\n';

	test('opens no card and edits no bytes while the range is painted', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto('?presentationMode=live');
		await ep.loadContent(LINKED);
		await ep.waitForRenderFlush();
		const before = await ep.bridge.getSource();

		// Arrow-walk the caret into the link text — a click there would open the card.
		await clickWordSettled(ep, page, 'Visit');
		await landAt(ep, page, 9);
		// The first press may extend natively inside the block; keep going until the range is
		// the editor's. The anchor — where the collapsed native caret parks — stays in the link.
		for (let i = 0; i < 3; i++) {
			await page.keyboard.press('Shift+ArrowDown');
			await ep.waitForRenderFlush();
			if ((await page.locator('[data-cross-block]').count()) > 0) break;
		}
		await ep.waitForCrossBlock(true);

		await page.keyboard.press('ControlOrMeta+k');
		await ep.waitForRenderFlush();

		await expect(page.locator('[data-link-card]')).toHaveCount(0);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
		await ep.waitForCrossBlock(true);
	});
});

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
