import { type Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { MermaidPage } from './mermaid-helpers';

/**
 * Opening a diagram's source at the document's END must not cost the reader more scroll than
 * the swap's own height loss (requirements/plugins/mermaid-source-scroll.md). The tall render
 * gives way to a short card, and the transient layout the card passes through on its way to its
 * fitted height is where a scrollport already at its bottom clamps too far.
 */

// The showcase's own trailing diagram: tall rendered, short source. The height it loses is what
// pulls the scrollport up, and the card's transient two-row layout is what it falls short of on
// the way to its fitted height.
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
		// The click focuses the block AND reveals the hover-gated toolbar the test presses next.
		await editor.viewport.click();
		await editor.waitForRenderFlush();
		before = await portGeometry(page);
		// Only a fixture while the diagram really is a tall thing at the bottom of a scrolled
		// document: a fixture that stopped being either passes every assertion below vacuously.
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

		// Sub-pixel layout makes the two deltas differ by a fraction, never by the card's
		// unfitted shortfall.
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
