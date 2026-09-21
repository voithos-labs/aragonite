import { expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import { wholeBlockInput } from '../../whole-block-input';

// The shared page object for the mermaid suites. They all drive the same block, which has no
// children, through the same buttons, so the locators and the wait for a render live here once.

export const MERMAID_FENCE = '```mermaid\ngraph TD\n\tA[Start] --> B[Finish]\n```';
/** One valid diagram between two prose blocks, the shape every focus, reorder, delete and
 *  selection case is written against. */
export const STANDARD_DIAGRAM_DOC = `Above text\n\n${MERMAID_FENCE}\n\ntail text\n`;

// Long on purpose: the renderer loads through a dynamic import the dev server transforms once.
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
	 *  the element that takes focus sits in the frame beside it. */
	get inputHost() {
		return wholeBlockInput(this.block);
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
		await expect(this.viewport.locator('svg')).toHaveCount(1, { timeout: RENDER_TIMEOUT });
	}
}
