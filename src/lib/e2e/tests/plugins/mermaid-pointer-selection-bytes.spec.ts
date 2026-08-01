import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

/**
 * Cross-block BYTES for a pointer drag ending inside a rendered diagram
 * (requirements/plugins/mermaid-pointer-selection-bytes.md). The block offers no character
 * surface, so the endpoint must take the unit whole — rects cannot see this class, and the
 * keyboard mint (offset 0 / end) never produces the interior offset a drag does.
 */

const DIAGRAM = '```mermaid\ngraph TD\n\tA[Start] --> B[Finish]\n```';
const DOC = `Above text\n\n${DIAGRAM}\n\ntail text\n`;

test.describe('pointer drag into a rendered diagram', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('mermaid');
		await editor.loadContent(DOC);
		await expect(page.locator('.mermaid-viewport svg')).toHaveCount(1, { timeout: 30_000 });
	});

	/** Press inside "Above text" after "Above ", then hold the drag onto the diagram's middle. */
	async function dragIntoDiagram(): Promise<void> {
		const start = await editor.pointForOffset([0], 6);
		const box = await editor.page.locator('.mermaid-viewport').boundingBox();
		if (!box) throw new Error('the rendered diagram has no bounding box');
		const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

		await editor.page.mouse.move(start.x, start.y);
		await editor.page.mouse.down();
		for (let step = 1; step <= 10; step++) {
			const t = step / 10;
			await editor.page.mouse.move(
				start.x + (target.x - start.x) * t,
				start.y + (target.y - start.y) * t
			);
		}
		await editor.page.mouse.up();
		await editor.waitForCrossBlock(true);
	}

	test('Mod+C copies the diagram whole, fence included', async ({ page }) => {
		await dragIntoDiagram();

		await page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();

		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`text\n\n${DIAGRAM}`);
	});

	test('Mod+X removes the diagram whole, leaving no fence remnant', async ({ page }) => {
		await dragIntoDiagram();

		await page.keyboard.press('ControlOrMeta+x');
		await editor.bridge.waitForSourceNotContains('mermaid');

		expect(await editor.bridge.getSource()).toBe('Above \n\ntail text\n');
	});
});
