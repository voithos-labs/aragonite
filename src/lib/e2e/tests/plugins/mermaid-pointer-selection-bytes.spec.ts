import { test, expect } from '../../fixtures';
import { PluginsPage, dragBetweenPoints } from './helpers';
import { MERMAID_FENCE, STANDARD_DIAGRAM_DOC } from './mermaid-helpers';

/**
 * The cross-block bytes for a pointer drag ending inside a rendered diagram
 * (requirements/plugins/mermaid-pointer-selection-bytes.md). The block offers no text to address,
 * so the endpoint must take it whole. Rects cannot show this, and a keyboard selection, which only
 * gives offset 0 or the end, never produces the interior offset a drag does.
 */

test.describe('pointer drag into a rendered diagram', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('mermaid');
		await editor.loadContent(STANDARD_DIAGRAM_DOC);
		await expect(page.locator('.mermaid-viewport svg')).toHaveCount(1, { timeout: 30_000 });
	});

	/** Press inside "Above text" after "Above ", then drag onto the diagram's middle. */
	async function dragIntoDiagram(): Promise<void> {
		const start = await editor.pointForOffset([0], 6);
		const box = await editor.page.locator('.mermaid-viewport').boundingBox();
		if (!box) throw new Error('the rendered diagram has no bounding box');
		const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

		await dragBetweenPoints(editor.page, start, target);
		await editor.waitForCrossBlock(true);
	}

	test('Mod+C copies the diagram whole, fence included', async ({ page }) => {
		await dragIntoDiagram();

		await page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();

		expect(await editor.readClipboard()).toBe(`text\n\n${MERMAID_FENCE}`);
	});

	test('Mod+X removes the diagram whole, leaving no fence remnant', async ({ page }) => {
		await dragIntoDiagram();

		await page.keyboard.press('ControlOrMeta+x');
		await editor.bridge.waitForSourceNotContains('mermaid');

		expect(await editor.bridge.getSource()).toBe('Above \n\ntail text\n');
	});
});
