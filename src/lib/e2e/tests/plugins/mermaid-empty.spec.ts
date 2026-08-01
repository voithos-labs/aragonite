import { test, expect } from '../../fixtures';
import { PluginsPage, roundTripStable } from './helpers';

/**
 * An empty mermaid fence (requirements/plugins/mermaid-empty.md): the edit surface IS the
 * view, so the keystroke that completes the info string lands the caret typing-ready instead
 * of on an error card. Reading mode gets a placeholder.
 */

const EMPTY_FENCE = 'Above\n\n```mermaid\n```\n\ntail\n';

class EmptyMermaidPage extends PluginsPage {
	get block() {
		return this.page.locator('.mermaid-block');
	}

	get textarea() {
		return this.page.getByTestId('mermaid-source');
	}

	get error() {
		return this.page.locator('.mermaid-error');
	}

	get placeholder() {
		return this.page.locator('.mermaid-empty');
	}

	async setPresentationMode(mode: string): Promise<void> {
		await this.page.evaluate((m) => (window as any).__test.setPresentationMode(m), mode);
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

		// The landed caret is the diagram's own: typing continues into the code.
		await page.keyboard.type('graph TD');
		await page.keyboard.press('Control+Enter');
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
		await page.keyboard.press('Control+Enter');

		await editor.bridge.waitForSourceEquals('Above\n\n```mermaid\n```\n\ntail\n');
		await expect(editor.textarea).toBeFocused();
		await expect(editor.error).toHaveCount(0);
		expect(await roundTripStable(page)).toBe(true);
	});

	test('a whitespace-only body is empty too — the edit surface, not an error card', async ({
		page
	}) => {
		// A valid diagram beside it, whose SVG is the settle point: it proves the engine ran a
		// render pass, so the absent error card below is a real absence and not a race.
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
