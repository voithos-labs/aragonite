import { type Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { dragBetweenPoints } from './helpers';
import { MermaidPage, STANDARD_DIAGRAM_DOC } from './mermaid-helpers';

/**
 * A drag the diagram claims for its own pan seeds no block range
 * (requirements/plugins/mermaid-pan-gesture.md). The editor's margin-drag arm reads the press
 * before the plugin's own handler runs, so only a declared gesture surface can decline it.
 */

const BROKEN_DOC = 'Above text\n\n```mermaid\nnotadiagram broken\n```\n\ntail text\n';

interface PressAftermath {
	crossBlock: boolean;
	overlays: number;
	focusInsideBlock: boolean;
}

async function pressAftermath(editor: MermaidPage): Promise<PressAftermath> {
	return {
		crossBlock: await editor.bridge.isCrossBlockActive(),
		...(await editor.page.evaluate(() => ({
			overlays: document.querySelectorAll('.selection-overlay-middle, .selection-overlay-endpoint')
				.length,
			focusInsideBlock: !!document.activeElement?.closest('.mermaid-block')
		})))
	};
}

/** A held drag across the middle of `selector`, the gesture a user pans with. */
async function dragAcross(editor: MermaidPage, selector: string): Promise<void> {
	const box = await editor.page.locator(selector).boundingBox();
	if (!box) throw new Error(`${selector} has no bounding box`);
	const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await dragBetweenPoints(editor.page, from, { x: from.x + 60, y: from.y + 20 });
	await editor.waitForRenderFlush();
}

const canvasTransform = (page: Page, selector: string) =>
	page.locator(selector).evaluate((el: HTMLElement) => el.style.transform);

test.describe('a diagram pan claims its own drag', () => {
	let editor: MermaidPage;

	test.beforeEach(async ({ page }) => {
		editor = new MermaidPage(page);
		await editor.loadDiagram(STANDARD_DIAGRAM_DOC);
	});

	test('panning a focused diagram moves the canvas and paints no range', async ({ page }) => {
		await editor.viewport.click();
		await expect(editor.inputHost).toBeFocused();

		await dragAcross(editor, '.mermaid-viewport');

		expect(await canvasTransform(page, '.mermaid-viewport .mermaid-canvas')).toBe(
			'translate(60px, 20px) scale(1)'
		);
		expect(await pressAftermath(editor)).toEqual({
			crossBlock: false,
			overlays: 0,
			focusInsideBlock: true
		});
	});

	test('panning inside the focus-view overlay paints no range either', async ({ page }) => {
		await editor.viewport.click();
		await page.getByTestId('mermaid-focus').click();
		await expect(page.getByTestId('mermaid-overlay')).toBeVisible();

		await dragAcross(editor, '.mermaid-overlay-viewport');

		expect(await canvasTransform(page, '.mermaid-overlay-viewport .mermaid-canvas')).toBe(
			'translate(60px, 20px) scale(1)'
		);
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
	});

	// The door is the declared surface, not the kind: the error card declares no gesture, so a
	// drag on it still takes the block as a unit the way a drag on any rendered face does.
	test('a drag on the error card still takes the block whole', async () => {
		await editor.loadDiagram(BROKEN_DOC, 'error');

		await dragAcross(editor, '.mermaid-surface');

		await editor.waitForCrossBlock(true);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});
});
