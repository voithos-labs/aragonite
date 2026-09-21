import { test, expect } from '../../fixtures';
import { MermaidPage, STANDARD_DIAGRAM_DOC } from './mermaid-helpers';

// Requirements: e2e/requirements/plugins/mermaid-tab-order.md.

/** Where each Tab left focus: the diagram itself, another stop inside the block, or outside. */
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

	// The confirmed defect: five keypresses went from the outer element to the diagram and then
	// through three toolbar buttons, never leaving the block, and typing at the diagram did
	// nothing.
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

	// The opposite control: the edit textarea really is an editing element, so taking it out of
	// the tab order would put the diagram's own edit mode out of keyboard reach.
	test('the edit textarea keeps its own tab stop', async ({ page }) => {
		// The toolbar appears on hover or focus inside, so the block is entered first, with the
		// same Shift+Tab the other tests measure, which is how a keyboard user reaches Edit.
		await editor.focusBlockStart(2);
		await page.keyboard.press('Shift+Tab');
		await expect(editor.inputHost).toBeFocused();

		await page.getByTestId('mermaid-edit').click();
		const textarea = page.getByTestId('mermaid-source');
		await expect(textarea).toBeFocused();
		await expect(textarea).not.toHaveAttribute('tabindex', '-1');
	});
});
