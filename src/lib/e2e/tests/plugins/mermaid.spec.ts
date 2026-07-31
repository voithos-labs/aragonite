import { test, expect } from '../../fixtures';
import { PluginsPage, roundTripStable, activeBlockPath } from './helpers';

/**
 * Mermaid reference plugin: render-primary block with plugin-owned editing
 * (requirements/plugins/mermaid.md). Seed `?seed=mermaid`: heading, two valid diagrams, one invalid
 * diagram, a ```js fence, a trailing paragraph. The first SVG waits carry a generous timeout — the
 * engine loads through a dynamic import the dev server transforms on first hit.
 */

const SEED = [
	'# Mermaid',
	'',
	'```mermaid',
	'graph TD',
	'\tA[Start] --> B[Finish]',
	'```',
	'',
	'```mermaid',
	'sequenceDiagram',
	'\tAlice->>Bob: Hello',
	'```',
	'',
	'```mermaid',
	'notadiagram',
	'broken',
	'```',
	'',
	'```js',
	'const x = 1;',
	'```',
	'',
	'After',
	''
].join('\n');

const FIRST_CODE = 'graph TD\n\tA[Start] --> B[Finish]';
const EDITED_CODE = 'graph LR\nX --> Y';
const EDITED_SEED = SEED.replace(FIRST_CODE, EDITED_CODE);

class MermaidPage extends PluginsPage {
	async gotoMermaid(): Promise<void> {
		await this.gotoPlugins('mermaid');
		await expect(this.svgs).toHaveCount(2, { timeout: 30_000 });
	}

	get blocks() {
		return this.page.locator('.mermaid-block');
	}

	get svgs() {
		return this.page.locator('.mermaid-viewport svg');
	}

	get textarea() {
		return this.page.getByTestId('mermaid-source');
	}

	get overlay() {
		return this.page.getByTestId('mermaid-overlay');
	}

	get firstViewport() {
		return this.page.locator('.mermaid-viewport').first();
	}

	/** Toolbar buttons stay hidden until the block is hovered/focused; a real user
	 *  hovers to reveal them, so reveal then click. */
	async clickToolbar(testId: string): Promise<void> {
		const block = this.blocks.first();
		await block.hover();
		await block.getByTestId(testId).click();
	}

	/** Open the first diagram's edit mode and replace its whole code. */
	async editFirstDiagram(newCode: string): Promise<void> {
		await this.clickToolbar('mermaid-edit');
		await expect(this.textarea).toHaveValue(FIRST_CODE);
		await this.page.keyboard.press('ControlOrMeta+a');
		await this.page.keyboard.type(newCode);
	}
}

test.describe('mermaid reference plugin', () => {
	let editor: MermaidPage;

	test.beforeEach(async ({ page }) => {
		editor = new MermaidPage(page);
		await editor.gotoMermaid();
	});

	test('seed renders both diagrams as the mermaid kind with SVG; ```js stays fencedCode', async () => {
		await expect(editor.blocks).toHaveCount(3);
		for (const i of [1, 2, 3]) expect(await editor.bridge.getBlockKind(i)).toBe('mermaid');
		expect(await editor.bridge.getBlockKind(4)).toBe('fencedCode');
		expect(await roundTripStable(editor.page)).toBe(true);
	});

	test('edit → Ctrl+Enter commits the new code byte-exactly into the fence', async ({ page }) => {
		await editor.editFirstDiagram(EDITED_CODE);
		await page.keyboard.press('Control+Enter');

		await editor.bridge.waitForSourceContains(EDITED_CODE);
		expect(await editor.bridge.getSource()).toBe(EDITED_SEED);
		await expect(editor.textarea).toHaveCount(0);
		expect(await roundTripStable(editor.page)).toBe(true);
	});

	test('one undo after a commit restores the previous source byte-exactly', async () => {
		await editor.editFirstDiagram(EDITED_CODE);
		await editor.page.keyboard.press('Control+Enter');
		await editor.bridge.waitForSourceContains(EDITED_CODE);

		// Undo rides the focused leaf's global chord tier, so land the caret first.
		await editor.getBlock(5).click();
		await editor.undo();
		await editor.bridge.waitForSourceNotContains(EDITED_CODE);
		expect(await editor.bridge.getSource()).toBe(SEED);
	});

	test('Escape cancels the edit without touching the source', async ({ page }) => {
		await editor.editFirstDiagram(EDITED_CODE);
		await page.keyboard.press('Escape');

		await expect(editor.textarea).toHaveCount(0);
		expect(await editor.bridge.getSource()).toBe(SEED);
	});

	test('a blur commit persists the edit without stealing the clicked caret', async () => {
		await editor.editFirstDiagram(EDITED_CODE);
		await editor.getBlock(5).click();

		await editor.bridge.waitForSourceContains(EDITED_CODE);
		expect(await editor.bridge.getSource()).toBe(EDITED_SEED);
		expect(await activeBlockPath(editor.page)).toEqual([5]);
	});

	test('invalid code renders a legible error and the editor keeps working', async ({ page }) => {
		const error = editor.blocks.nth(2).locator('.mermaid-error');
		await expect(error).toBeVisible({ timeout: 30_000 });
		await expect(error).toContainText('Mermaid error');

		await editor.getBlock(5).click();
		await page.keyboard.press('End');
		await page.keyboard.type(' ok');
		expect(await editor.getBlockText(5)).toBe('After ok');
	});

	test('focus view opens via the button and Escape closes it', async ({ page }) => {
		await editor.clickToolbar('mermaid-focus');
		await expect(editor.overlay).toHaveCount(1);

		await page.keyboard.press('Escape');
		await expect(editor.overlay).toHaveCount(0);
	});

	test('Mod+M on the focused diagram viewport opens the focus view', async ({ page }) => {
		await editor.firstViewport.click();
		await page.keyboard.press('ControlOrMeta+m');
		await expect(editor.overlay).toHaveCount(1);

		await page.keyboard.press('Escape');
		await expect(editor.overlay).toHaveCount(0);
	});

	test('single click focuses the viewport; double click enters edit mode', async () => {
		await editor.firstViewport.click();
		await expect(editor.firstViewport).toBeFocused();
		await expect(editor.textarea).toHaveCount(0);

		await editor.firstViewport.dblclick();
		await expect(editor.textarea).toHaveValue(FIRST_CODE);
	});

	test('Tab in the source inserts a tab and stays in edit mode', async ({ page }) => {
		await editor.clickToolbar('mermaid-edit');
		await expect(editor.textarea).toHaveValue(FIRST_CODE);

		await page.keyboard.press('ControlOrMeta+Home');
		await page.keyboard.press('Tab');

		await expect(editor.textarea).toHaveValue('\t' + FIRST_CODE);
		await expect(editor.textarea).toBeFocused();
	});

	test('round-trip stability after the full edit + focus-view flow', async ({ page }) => {
		await editor.editFirstDiagram(EDITED_CODE);
		await page.keyboard.press('Control+Enter');
		await editor.bridge.waitForSourceContains(EDITED_CODE);

		await editor.blocks.first().getByTestId('mermaid-focus').click();
		await expect(editor.overlay).toHaveCount(1);
		await page.keyboard.press('Escape');
		await expect(editor.overlay).toHaveCount(0);

		expect(await editor.bridge.getSource()).toBe(EDITED_SEED);
		expect(await roundTripStable(editor.page)).toBe(true);
	});
});
