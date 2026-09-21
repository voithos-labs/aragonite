import { type Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { MermaidPage } from './mermaid-helpers';

/**
 * Opening a diagram's source at the end of the document must not move the user further than the
 * height the swap itself loses (requirements/plugins/mermaid-source-scroll.md). The tall render
 * gives way to a short box, and the momentary layout that box passes through on its way to its
 * final height is where a scroll container already at its bottom clamps too far.
 */

// The showcase's own trailing diagram: tall rendered, short in source. The height it loses is what
// pulls the scroll container up, and the box's momentary two-row layout is what it falls short of
// on the way to its final height.
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
const DOC = `${PROSE}\n\n${TALL_DIAGRAM}\n`;

interface PortGeometry {
	scrollTop: number;
	maxScrollTop: number;
	portHeight: number;
	scrollHeight: number;
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
			maxScrollTop: port.scrollHeight - port.clientHeight,
			portHeight: port.clientHeight,
			scrollHeight: port.scrollHeight,
			blockTop: blockRect.top - portRect.top,
			blockBottom: blockRect.bottom - portRect.top
		};
	});
}

test.describe('opening a diagram source at the document end', () => {
	let editor: MermaidPage;
	let before: PortGeometry;

	test.beforeEach(async ({ page }) => {
		editor = new MermaidPage(page);
		await editor.loadDiagram(DOC);
		await editor.scrollEditorTo(1e6);
		await editor.waitForRenderFlush();
		// The click focuses the block and brings up the hover-only toolbar the test clicks next.
		await editor.viewport.click();
		await editor.waitForRenderFlush();
		before = await portGeometry(page);
		// This is only a fixture while the diagram really is tall and at the bottom of a scrolled
		// document; one that stopped being either would pass every assertion below for nothing.
		expect(before.scrollTop).toBe(before.maxScrollTop);
		expect(before.blockBottom - before.blockTop).toBeGreaterThan(before.portHeight / 3);
	});

	async function openSource(page: Page): Promise<PortGeometry> {
		await page.getByTestId('mermaid-edit').click();
		await editor.textarea.waitFor({ state: 'visible' });
		await editor.waitForRenderFlush();
		await editor.waitForRenderFlush();
		const after = await portGeometry(page);
		expect(after.scrollHeight).toBeLessThan(before.scrollHeight);
		return after;
	}

	test('the swap costs no scroll beyond the height it removed', async ({ page }) => {
		const after = await openSource(page);

		// Sub-pixel layout makes the two differences vary by a fraction, never by the gap the
		// box's momentary layout would leave.
		expect(before.scrollTop - after.scrollTop).toBeCloseTo(
			before.scrollHeight - after.scrollHeight,
			0
		);
		expect(after.scrollTop).toBeCloseTo(after.maxScrollTop, 0);
	});

	test('the source card lands fully inside the scrollport', async ({ page }) => {
		const after = await openSource(page);

		expect(after.blockBottom - after.blockTop).toBeLessThan(after.portHeight);
		expect(after.blockTop).toBeGreaterThanOrEqual(0);
		expect(after.blockBottom).toBeLessThanOrEqual(after.portHeight);
	});
});
