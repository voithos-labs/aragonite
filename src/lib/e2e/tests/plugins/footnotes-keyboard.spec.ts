import { test, expect } from '../../fixtures';
import type { Locator } from '@playwright/test';
import { expectNoNewA11yViolations } from '../../a11y/axe-helper';
import { focusedStop } from '../../page-probes';
import { PluginsPage, blockView, capturedErrors, textRunCenter } from './helpers';

// Following a footnote from the keyboard (requirements/plugins/footnotes-keyboard.md): both
// markers are links with a tab stop in reading mode, and no stop at all in the editing modes.

// A capped viewport keeps the definitions unmounted, so a jump has to mount its target.
test.use({ viewport: { width: 1000, height: 700 } });

const FILLER = 140;
const SHORT_DOC = 'Body has [^a] and [^b] here.\n\n[^a]: First note.\n\n[^b]: Second note.\n';

function navDoc(): { md: string; defA: number } {
	const parts = ['Body has [^a] and [^b] here.'];
	for (let i = 0; i < FILLER; i++) parts.push(`Filler paragraph ${i} with enough words.`);
	const defA = parts.length;
	parts.push('[^a]: First note.', '[^b]: Second note.');
	return { md: parts.join('\n\n') + '\n', defA };
}

class FootnotePage extends PluginsPage {
	refs(block = 0): Locator {
		return this.page.locator(`[data-block-path='[${block}]'] .footnote-ref`);
	}
	defMarker(block: number): Locator {
		return this.page.locator(`[data-block-path='[${block}]'] .footnote-def-marker`);
	}
	async load(md: string, mode: string): Promise<void> {
		await this.gotoPlugins('footnotes-ref');
		await this.loadContent(md);
		await this.setPresentationMode(mode);
		await this.waitForRenderFlush();
	}
	/** Click a word of the block's text, away from any marker, then press the key once. */
	async pressFromText(path: number[], word: string, key = 'Tab'): Promise<void> {
		const point = await textRunCenter(this.page, path, word);
		await this.page.mouse.click(point.x, point.y);
		await this.page.keyboard.press(key);
	}
}

test.describe('footnotes: reading mode keyboard navigation', () => {
	let editor: FootnotePage;
	test.beforeEach(({ page }) => {
		editor = new FootnotePage(page);
	});

	test('Tab reaches the reference, and Enter jumps to its definition', async ({ page }) => {
		const { md, defA } = navDoc();
		await editor.load(md, 'reading');
		await expect(editor.refs().nth(0)).toHaveAccessibleName('Footnote 1');

		await editor.pressFromText([0], 'Body');
		await expect(editor.refs().nth(0)).toBeFocused();
		await page.keyboard.press('Enter');

		await expect.poll(() => blockView(page, [defA])).toEqual({ mounted: true, inView: true });
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Tab reaches the definition’s marker, and Enter jumps back to the reference', async ({
		page
	}) => {
		const { md, defA } = navDoc();
		await editor.load(md, 'reading');
		await editor.pressFromText([0], 'Body');
		await page.keyboard.press('Enter');
		await expect.poll(() => blockView(page, [defA])).toEqual({ mounted: true, inView: true });
		await expect(page.locator("[data-block-path='[0]']")).toHaveCount(0);

		const marker = editor.defMarker(defA);
		await expect(marker).toHaveAccessibleName('Back to reference a');
		await editor.pressFromText([defA, 0], 'First');
		await expect(marker).toBeFocused();
		await page.keyboard.press('Enter');

		await expect.poll(() => blockView(page, [0])).toEqual({ mounted: true, inView: true });
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('a footnote document has no new axe violations', async ({ page }) => {
		await editor.load(SHORT_DOC, 'reading');
		await expectNoNewA11yViolations(page, 'footnotes-reading');
	});
});

test.describe('footnotes: no tab stop in the editing modes', () => {
	// Shift+Tab leaves a prose block natively (Tab inserts a tab), so each press lands on the
	// previous tab stop in the page: a marker if it had one, else the block's own editing surface.
	test('live mode: neither marker is a tab stop, and Shift+Tab skips both', async ({ page }) => {
		const editor = new FootnotePage(page);
		await editor.load(SHORT_DOC, 'live');
		await expect(editor.refs().nth(0)).not.toHaveAttribute('tabindex');
		await expect(editor.defMarker(1)).not.toHaveAttribute('tabindex');

		await editor.pressFromText([2, 0], 'Second', 'Shift+Tab');
		expect(await focusedStop(page)).toEqual({ path: [1, 0], isSurface: true });
		await page.keyboard.press('Shift+Tab');
		expect(await focusedStop(page)).toEqual({ path: [0], isSurface: true });
		expect(await capturedErrors(page)).toEqual([]);
	});
});
