import { test, expect } from '../../fixtures';
import { readDoc, waitForDoc } from './helpers';
import { attachIme } from '../../simulation/ime';
import { MermaidPage, STANDARD_DIAGRAM_DOC } from './mermaid-helpers';

// Requirements: `e2e/requirements/plugins/mermaid-ime-mint.md`.

class MermaidImePage extends MermaidPage {
	async focusDiagram(): Promise<void> {
		await this.viewport.click();
		await expect(this.inputHost).toBeFocused();
	}
}

test.describe('mermaid whole-block focus: AltGr and IME input', () => {
	let editor: MermaidImePage;

	test.beforeEach(async ({ page }) => {
		editor = new MermaidImePage(page);
		await editor.loadDiagram(STANDARD_DIAGRAM_DOC);
	});

	test('an AltGr-shaped insert of `€` creates a paragraph below, leaving the diagram intact', async ({
		page
	}) => {
		await editor.focusDiagram();

		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Input.insertText', { text: '€' });

		await waitForDoc(page, (s) => s.rootCount === 4);
		const doc = await readDoc(page);
		expect(doc.kinds).toEqual(['paragraph', 'mermaid', 'paragraph', 'paragraph']);
		expect(doc.texts[2]).toBe('€');
		expect(doc.texts[1]).toContain('graph TD');
	});

	test('a committed composition creates the composed text below', async ({ page }) => {
		await editor.focusDiagram();
		const ime = await attachIme(page);

		await ime.compose('にほん');
		await ime.commit('日本');

		await waitForDoc(page, (s) => s.rootCount === 4);
		expect((await readDoc(page)).texts[2]).toBe('日本');
	});

	// The element the plugin declares is replaced on every redraw, which is why the element that
	// takes focus sits in the frame: anything mounted inside the diagram would be lost here.
	test('the host survives a redraw and still creates', async ({ page }) => {
		await editor.viewport.dblclick();
		await expect(editor.page.getByTestId('mermaid-source')).toBeFocused();
		await page.keyboard.press('End');
		await page.keyboard.type('\n\tB --> C[Done]');
		await page.keyboard.press('ControlOrMeta+Enter');

		await expect(editor.viewport.locator('svg')).toHaveCount(1, { timeout: 30_000 });
		await expect(editor.inputHost).toBeFocused();

		const ime = await attachIme(page);
		await ime.compose('にほん');
		await ime.commit('日本');

		await waitForDoc(page, (s) => s.rootCount === 4);
		expect((await readDoc(page)).texts[2]).toBe('日本');
	});

	// The redraw hands focus back only for an arrival not from the outer element; a broader hand-off
	// leaves focus on the diagram, where the next AltGr or composition drops, seen only here.
	test('focus settles on the host after the redraw, not on the new viewport', async ({ page }) => {
		await editor.viewport.dblclick();
		await expect(editor.page.getByTestId('mermaid-source')).toBeFocused();
		await page.keyboard.press('End');
		await page.keyboard.type('\n\tB --> C[Done]');
		await page.keyboard.press('ControlOrMeta+Enter');

		await expect(editor.viewport.locator('svg')).toHaveCount(1, { timeout: 30_000 });
		await editor.waitForRenderFlush();
		await editor.waitForRenderFlush();

		await expect(editor.inputHost).toBeFocused();
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Input.insertText', { text: '€' });
		await waitForDoc(page, (s) => s.rootCount === 4);
		expect((await readDoc(page)).texts[2]).toBe('€');
	});

	// A toolbar click is focus arriving from inside the frame; a hand-off that skipped it would leave
	// the next click on the declared element, where only IME composition breaks.
	test('a click after a toolbar button still reaches the editing host', async ({ page }) => {
		await editor.block.hover();
		await editor.block.getByTestId('mermaid-reset').click();

		await editor.viewport.click();

		await expect(editor.inputHost).toBeFocused();
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Input.insertText', { text: '€' });
		await waitForDoc(page, (s) => s.rootCount === 4);
		expect((await readDoc(page)).texts[2]).toBe('€');
	});

	// The outer element must not take focus from the textarea, or each keystroke makes a paragraph;
	// typed, since the CDP driver waits on `textContent`, which a textarea lacks.
	test('the edit textarea keeps its own caret', async ({ page }) => {
		const before = await editor.bridge.getSource();
		await editor.viewport.dblclick();
		const textarea = page.getByTestId('mermaid-source');
		await expect(textarea).toBeFocused();

		await page.keyboard.type('X');

		await expect(textarea).toBeFocused();
		await expect(textarea).toHaveValue(/X/);
		expect(await editor.bridge.getSource()).toBe(before); // uncommitted draft, no mint
	});
});
