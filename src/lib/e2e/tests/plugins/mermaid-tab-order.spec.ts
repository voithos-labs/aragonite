import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import { wholeBlockInput } from '../../whole-block-input';

// Requirements: e2e/requirements/plugins/mermaid-tab-order.md.

const DOC = 'Above text\n\n```mermaid\ngraph TD\n\tA[Start] --> B[Finish]\n```\n\ntail text\n';

class MermaidTabPage extends PluginsPage {
	async setup(): Promise<void> {
		await this.gotoPlugins('mermaid');
		await this.loadContent(DOC);
		await expect(this.viewport.locator('svg')).toHaveCount(1, { timeout: 30_000 });
	}

	get viewport() {
		return this.page.locator('.mermaid-viewport');
	}

	get inputHost() {
		return wholeBlockInput(this.page.locator('.mermaid-block'));
	}
}

/** Where each tab press parked: the diagram surface, some other stop inside the block, or out. */
function focusedStop(page: MermaidTabPage['page']): Promise<'viewport' | 'in-block' | 'outside'> {
	return page.evaluate(() => {
		const active = document.activeElement;
		if (active?.classList.contains('mermaid-viewport')) return 'viewport' as const;
		return active?.closest('.mermaid-block') ? ('in-block' as const) : ('outside' as const);
	});
}

test.describe('a plugin whole-block kind is one EDITING tab stop', () => {
	let editor: MermaidTabPage;

	test.beforeEach(async ({ page }) => {
		editor = new MermaidTabPage(page);
		await editor.setup();
	});

	test('Shift+Tab from below lands on the editing host, not on the diagram', async ({ page }) => {
		await editor.focusBlockStart(2);

		await page.keyboard.press('Shift+Tab');

		await expect(editor.inputHost).toBeFocused();
		await expect(editor.viewport).toHaveAttribute('tabindex', '-1');
	});

	// The confirmed defect: five presses walked host → viewport → three toolbar buttons and never
	// left the block, with typing at the viewport stop producing nothing.
	test('continuing backward walks only the toolbar and then leaves the block', async ({ page }) => {
		await editor.focusBlockStart(2);
		await page.keyboard.press('Shift+Tab');
		await expect(editor.inputHost).toBeFocused();

		const stops: string[] = [];
		for (let i = 0; i < 4; i++) {
			await page.keyboard.press('Shift+Tab');
			stops.push(await focusedStop(page));
		}

		expect(stops).not.toContain('viewport');
		expect(stops[stops.length - 1]).toBe('outside');
	});

	// Inverse control: the edit textarea IS an editing host, so demoting it would put the
	// diagram's own edit mode out of keyboard reach.
	test('the edit textarea keeps its own tab stop', async ({ page }) => {
		// The toolbar reveals on hover/focus-within, so the block is entered first — by the same
		// Shift+Tab the siblings measure, which is how a keyboard user reaches Edit at all.
		await editor.focusBlockStart(2);
		await page.keyboard.press('Shift+Tab');
		await expect(editor.inputHost).toBeFocused();

		await page.getByTestId('mermaid-edit').click();
		const textarea = page.getByTestId('mermaid-source');
		await expect(textarea).toBeFocused();
		await expect(textarea).not.toHaveAttribute('tabindex', '-1');
	});
});
