import { type Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { MermaidPage } from './mermaid-helpers';

/**
 * Opening a diagram's source in the middle of a document leaves the page where it was
 * (requirements/plugins/mermaid-source-scroll.md). At the document's end the scroll container has
 * to come up by the height the swap removed; `view-swap-end-scroll.spec.ts` covers that.
 */

// The showcase's trailing diagram: tall rendered, short in source.
const TALL_DIAGRAM = [
	'```mermaid',
	'xychart-beta',
	'    title "productivity vs. caffeine"',
	'    x-axis "Cups" [0, 1, 2, 3, 4, 5, 6]',
	'    y-axis "10x Engineer Units" 0 --> 1000',
	'    line [5, 40, 160, 480, 950, 0, 0]',
	'```'
].join('\n');

const PROSE = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} of filler prose.`).join('\n\n');

interface PortGeometry {
	scrollTop: number;
	portHeight: number;
	blockTop: number;
	blockBottom: number;
}

function portGeometry(page: Page): Promise<PortGeometry> {
	return page.evaluate(() => {
		const port = document.querySelector('.editor') as HTMLElement;
		const block = document.querySelector('.mermaid-block') as HTMLElement;
		const portRect = port.getBoundingClientRect();
		const blockRect = block.getBoundingClientRect();
		return {
			scrollTop: port.scrollTop,
			portHeight: port.clientHeight,
			blockTop: blockRect.top - portRect.top,
			blockBottom: blockRect.bottom - portRect.top
		};
	});
}

test.describe('opening a diagram source that runs off the bottom of the screen', () => {
	test('the page stays where it was', async ({ page }) => {
		const editor = new MermaidPage(page);
		await editor.loadDiagram(`${PROSE}\n\n${TALL_DIAGRAM}\n\n${PROSE}\n`);
		// The diagram's top two thirds of the way down the scroll container, its lower half past
		// the bottom edge.
		const top = await page.evaluate(() => {
			const port = document.querySelector('.editor') as HTMLElement;
			const block = document.querySelector('.mermaid-block') as HTMLElement;
			const at = block.getBoundingClientRect().top - port.getBoundingClientRect().top;
			return port.scrollTop + at - (port.clientHeight * 2) / 3;
		});
		await editor.scrollEditorTo(top);
		const before = await portGeometry(page);
		expect(before.blockTop).toBeGreaterThan(0);
		expect(before.blockBottom).toBeGreaterThan(before.portHeight);

		// A click in the diagram's visible top, which the toolbar needs, then its Edit control.
		const box = (await editor.viewport.boundingBox())!;
		await page.mouse.click(box.x + box.width / 2, box.y + 20);
		await editor.waitForRenderFlush();
		const clicked = await portGeometry(page);
		await page.getByTestId('mermaid-edit').click();
		await editor.textarea.waitFor({ state: 'visible' });
		await expect(editor.textarea).toBeFocused();
		await editor.waitForRenderFlush();
		await editor.waitForRenderFlush();

		expect((await portGeometry(page)).scrollTop).toBe(clicked.scrollTop);
	});
});
