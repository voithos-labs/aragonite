import { test, expect } from '../../fixtures';
import { PluginsPage, activeBlockPath } from './helpers';

/**
 * Boundary arrow exits out of the diagram's edit box (requirements/plugins/mermaid-edit-exit.md).
 * A textarea swallows arrows at its own edges; an empty diagram, whose box IS its view, turns
 * that into a caret trap.
 */

const ONE_DIAGRAM = 'Above\n\n```mermaid\ngraph TD\n```\n\ntail\n';
const EDITED_CODE = 'graph LR\nX --> Y';

class EditExitPage extends PluginsPage {
	get block() {
		return this.page.locator('.mermaid-block');
	}

	get textarea() {
		return this.page.getByTestId('mermaid-source');
	}

	/** Open the box and replace its whole code, leaving the caret at the end of the draft. */
	async editDiagram(code: string): Promise<void> {
		await this.block.hover();
		await this.block.getByTestId('mermaid-edit').click();
		await expect(this.textarea).toHaveValue('graph TD');
		await this.page.keyboard.press('ControlOrMeta+a');
		await this.page.keyboard.type(code);
	}
}

test.describe('mermaid edit box — boundary arrow exits', () => {
	let editor: EditExitPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditExitPage(page);
		await editor.gotoPlugins('mermaid');
	});

	test('an empty diagram’s box releases the caret both ways', async ({ page }) => {
		await editor.loadContent('Above\n\ntail\n');
		await editor.getBlock(0).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.type('```mermaid');
		await expect(editor.textarea).toBeFocused();

		await page.keyboard.press('ArrowUp');
		expect(await activeBlockPath(page)).toEqual([0]);
		await page.keyboard.press('End');
		await page.keyboard.type('!');
		expect(await editor.getBlockText(0)).toBe('Above!');

		// The block survives the exit and still offers its box, so the way back in is an arrow too.
		await expect(editor.textarea).toHaveCount(1);
		await page.keyboard.press('ArrowDown');
		await expect(editor.textarea).toBeFocused();

		await page.keyboard.press('ArrowDown');
		expect(await activeBlockPath(page)).toEqual([2]);
		await page.keyboard.press('End');
		await page.keyboard.type('?');
		expect(await editor.getBlockText(2)).toBe('tail?');
	});

	test('ArrowUp on the first line exits upward and commits the draft', async ({ page }) => {
		await editor.loadContent(ONE_DIAGRAM);
		await editor.editDiagram(EDITED_CODE);

		await page.keyboard.press('ControlOrMeta+Home');
		await page.keyboard.press('ArrowUp');

		await editor.bridge.waitForSourceEquals(
			`Above\n\n\`\`\`mermaid\n${EDITED_CODE}\n\`\`\`\n\ntail\n`
		);
		expect(await activeBlockPath(page)).toEqual([0]);
		await expect(editor.textarea).toHaveCount(0);
	});

	test('an arrow mid-text stays in the box', async ({ page }) => {
		await editor.loadContent(ONE_DIAGRAM);
		await editor.editDiagram(EDITED_CODE);

		await page.keyboard.press('ControlOrMeta+Home');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowUp');

		await expect(editor.textarea).toBeFocused();
		expect(await editor.bridge.getSource()).toBe(ONE_DIAGRAM);
	});

	test('the horizontal edges exit too: ArrowRight at the end, ArrowLeft at offset 0', async ({
		page
	}) => {
		await editor.loadContent(ONE_DIAGRAM);
		await editor.editDiagram(EDITED_CODE);

		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.press('ArrowRight');
		expect(await activeBlockPath(page)).toEqual([2]);
		await page.keyboard.type('!');
		expect(await editor.getBlockText(2)).toBe('!tail');

		await editor.block.hover();
		await editor.block.getByTestId('mermaid-edit').click();
		await page.keyboard.press('ControlOrMeta+Home');
		await page.keyboard.press('ArrowLeft');
		expect(await activeBlockPath(page)).toEqual([0]);
	});

	test('Shift+ArrowUp at the first line extends in the box instead of leaving', async ({
		page
	}) => {
		await editor.loadContent(ONE_DIAGRAM);
		await editor.editDiagram(EDITED_CODE);

		await page.keyboard.press('ControlOrMeta+Home');
		await page.keyboard.press('Shift+ArrowUp');

		await expect(editor.textarea).toBeFocused();
		expect(await editor.bridge.getSource()).toBe(ONE_DIAGRAM);
	});

	// Pinned as it stands: an empty diagram has no other view to cancel back to, so Escape
	// keeps the box and the caret. The arrow is what leaves.
	test('Escape in an empty diagram’s box keeps the box and the caret', async ({ page }) => {
		await editor.loadContent('Above\n\n```mermaid\n```\n\ntail\n');
		await editor.textarea.click();
		await page.keyboard.press('Escape');

		await expect(editor.textarea).toHaveCount(1);
		await expect(editor.textarea).toBeFocused();
	});
});
