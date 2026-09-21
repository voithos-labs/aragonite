import { test, expect } from '../../fixtures';
import { roundTripStable } from './helpers';
import { MermaidPage } from './mermaid-helpers';

/**
 * An empty mermaid fence (requirements/plugins/mermaid-empty.md): the edit box is all there is to
 * see, so the keystroke that completes the info string leaves the caret ready to type rather than
 * on an error box. Reading mode shows a placeholder.
 */

const EMPTY_FENCE = 'Above\n\n```mermaid\n```\n\ntail\n';

class EmptyMermaidPage extends MermaidPage {
	get error() {
		return this.page.locator('.mermaid-error');
	}

	get placeholder() {
		return this.page.locator('.mermaid-empty');
	}
}

test.describe('mermaid empty diagram', () => {
	let editor: EmptyMermaidPage;

	test.beforeEach(async ({ page }) => {
		editor = new EmptyMermaidPage(page);
		await editor.gotoPlugins('mermaid');
	});

	test('the keystroke completing ```mermaid lands the caret in the edit surface, typing-ready', async ({
		page
	}) => {
		await editor.loadContent('Above\n\ntail\n');
		await editor.getBlock(0).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.type('```mermaid');

		expect(await editor.bridge.getBlockKind(1)).toBe('mermaid');
		await expect(editor.textarea).toBeFocused();
		await expect(editor.error).toHaveCount(0);

		// The caret is the diagram's own, so typing continues into the code.
		await page.keyboard.type('graph TD');
		await page.keyboard.press('ControlOrMeta+Enter');
		await editor.bridge.waitForSourceContains('```mermaid\ngraph TD');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('emptying a diagram’s code leaves the edit surface focused, never an error card', async ({
		page
	}) => {
		await editor.loadContent('Above\n\n```mermaid\ngraph TD\n```\n\ntail\n');
		await editor.block.hover();
		await editor.block.getByTestId('mermaid-edit').click();
		await expect(editor.textarea).toHaveValue('graph TD');

		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('Backspace');
		await page.keyboard.press('ControlOrMeta+Enter');

		await editor.bridge.waitForSourceEquals('Above\n\n```mermaid\n```\n\ntail\n');
		await expect(editor.textarea).toBeFocused();
		await expect(editor.error).toHaveCount(0);
		expect(await roundTripStable(page)).toBe(true);
	});

	test('a whitespace-only body is empty too — the edit surface, not an error card', async ({
		page
	}) => {
		// A valid diagram beside it, whose SVG is what the test waits for: it shows the renderer
		// ran, so the missing error box below is really missing rather than not drawn yet.
		await editor.loadContent('```mermaid\n   \n```\n\n```mermaid\ngraph TD\n```\n');
		await expect(page.locator('.mermaid-viewport svg')).toHaveCount(1, { timeout: 30_000 });

		await expect(editor.textarea).toHaveCount(1);
		await expect(editor.error).toHaveCount(0);
		expect(await roundTripStable(page)).toBe(true);
	});

	test('reading mode shows a dimmed placeholder instead of the edit surface or an error', async () => {
		await editor.loadContent(EMPTY_FENCE);
		await editor.setPresentationMode('reading');

		await expect(editor.placeholder).toHaveCount(1);
		await expect(editor.textarea).toHaveCount(0);
		await expect(editor.error).toHaveCount(0);
	});
});
