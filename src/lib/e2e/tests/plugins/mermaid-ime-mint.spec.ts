import { test, expect } from '../../fixtures';
import { PluginsPage, readDoc, waitForDoc } from './helpers';
import { attachIme } from '../../simulation/ime';
import { wholeBlockInput } from '../../whole-block-input';

// Requirements: e2e/requirements/plugins/mermaid-ime-mint.md. The SVG wait is generous: the
// engine loads through a dynamic import the dev server transforms on first hit.

const DOC = 'Above text\n\n```mermaid\ngraph TD\n\tA[Start] --> B[Finish]\n```\n\ntail text\n';

class MermaidImePage extends PluginsPage {
	async setup(): Promise<void> {
		await this.gotoPlugins('mermaid');
		await this.loadContent(DOC);
		await expect(this.viewport.locator('svg')).toHaveCount(1, { timeout: 30_000 });
	}

	get box() {
		return this.page.locator('.mermaid-block');
	}

	get viewport() {
		return this.page.locator('.mermaid-viewport');
	}

	get inputHost() {
		return wholeBlockInput(this.box);
	}

	async focusDiagram(): Promise<void> {
		await this.viewport.click();
		await expect(this.inputHost).toBeFocused();
	}
}

test.describe('mermaid whole-block focus — AltGr and IME input', () => {
	let editor: MermaidImePage;

	test.beforeEach(async ({ page }) => {
		editor = new MermaidImePage(page);
		await editor.setup();
	});

	test('an AltGr-shaped insert of `€` mints a paragraph below, leaving the diagram intact', async ({
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

	test('a committed composition mints the composed text below', async ({ page }) => {
		await editor.focusDiagram();
		const ime = await attachIme(page);

		await ime.compose('にほん');
		await ime.commit('日本');

		await waitForDoc(page, (s) => s.rootCount === 4);
		expect((await readDoc(page)).texts[2]).toBe('日本');
	});

	// The declared surface is replaced on every redraw, which is why the host lives in the box:
	// anything mounted in the viewport would die here.
	test('the host survives a redraw and still mints', async ({ page }) => {
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

	// The one declared surface that owns its caret: the host must not take focus from it, or
	// every keystroke of an edit session mints a paragraph instead of editing the draft. Typed
	// rather than composed — the CDP driver settles on `textContent`, which a textarea has none of.
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
