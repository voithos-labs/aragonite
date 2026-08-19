import { test, expect } from '../../fixtures';
import { MermaidPage, STANDARD_DIAGRAM_DOC } from './mermaid-helpers';

// Requirements: e2e/requirements/plugins/mermaid-tab-order.md.

/** Where each tab press parked: the diagram surface, some other stop inside the block, or out. */
function focusedStop(page: MermaidPage['page']): Promise<'viewport' | 'in-block' | 'outside'> {
	return page.evaluate(() => {
		const active = document.activeElement;
		if (active?.classList.contains('mermaid-viewport')) return 'viewport' as const;
		return active?.closest('.mermaid-block') ? ('in-block' as const) : ('outside' as const);
	});
}

test.describe('a plugin whole-block kind is one EDITING tab stop', () => {
	let editor: MermaidPage;

	test.beforeEach(async ({ page }) => {
		editor = new MermaidPage(page);
		await editor.loadDiagram(STANDARD_DIAGRAM_DOC);
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
