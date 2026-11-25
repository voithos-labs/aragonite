import { expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { PluginsPage } from './helpers';
import { wholeBlockInput } from '../../whole-block-input';

// The shared page object for the mermaid suites. They all drive the same block, which has no
// children, through the same buttons, so the locators and the wait for a render live here once.

export const MERMAID_FENCE = '```mermaid\ngraph TD\n\tA[Start] --> B[Finish]\n```';
/** One valid diagram between two prose blocks, the shape every focus, reorder, delete and
 *  selection case is written against. */
export const STANDARD_DIAGRAM_DOC = `Above text\n\n${MERMAID_FENCE}\n\ntail text\n`;
/** The block host a diagram draws in. */
export const DIAGRAM_HOST = '[data-block-kind="mermaid/diagram"]';

// Long on purpose: the renderer is a large module the page fetches on first use.
const RENDER_TIMEOUT = 30_000;

export class MermaidPage extends PluginsPage {
	get block() {
		return this.page.locator('.mermaid-block');
	}

	get viewport() {
		return this.page.locator('.mermaid-viewport');
	}

	get textarea() {
		return this.page.getByTestId('mermaid-source');
	}

	/** Where whole-block focus lands: the diagram's own element is replaced on every redraw, so
	 *  the element that takes focus sits beside it in the block's host. */
	get inputHost() {
		return wholeBlockInput(this.page.locator(DIAGRAM_HOST));
	}

	/** Open the mermaid seed and load `doc`, waiting for what the renderer produced for it. */
	async loadDiagram(doc: string, settle: 'svg' | 'error' = 'svg'): Promise<void> {
		await this.gotoPlugins('mermaid');
		await this.loadContent(doc);
		await this.settleDiagram(settle);
	}

	async settleDiagram(settle: 'svg' | 'error'): Promise<void> {
		if (settle === 'error') {
			await expect(this.page.locator('.mermaid-error')).toBeVisible({ timeout: RENDER_TIMEOUT });
			return;
		}
		await settleDiagrams(this.page);
	}
}

/** Waits for the page's `count` diagrams to draw, which grows each block and moves what's below. */
export async function settleDiagrams(page: Page, count = 1): Promise<void> {
	await expect(page.locator('.mermaid-viewport svg')).toHaveCount(count, {
		timeout: RENDER_TIMEOUT
	});
}
