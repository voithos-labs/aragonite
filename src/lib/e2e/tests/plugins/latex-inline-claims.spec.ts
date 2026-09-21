import { test, expect } from '../../fixtures';
import { PluginsPage, capturedErrors } from './helpers';

/**
 * Which `$…$` runs become formulas in real prose (requirements/plugins/latex-inline-claims.md).
 * The reported case is a formula opening with a digit inside a `:::tip`, so both the directive
 * body and a top-level paragraph are driven, and the prices beside them must stay literal.
 */

const DIRECTIVE = ':::tip Measure\nOne part in $10^5$ here.\n:::\n\nAfter\n';
const PARAGRAPH = 'One part in $10^5$ here.\n\nAfter\n';
const PRICES = ':::tip Budget\nIt costs $5 and $10, or $10-$20 shipped.\n:::\n\nAfter\n';

test.describe('inline math claims: a digit-opening formula renders, a price does not', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('math');
	});

	/** The directive's body paragraph, which only a nested path addresses. */
	function directiveBody() {
		return editor.page.locator("[data-block-path='[0,1]']");
	}

	for (const mode of ['source', 'live'] as const) {
		test(`${mode} mode: the formula inside a :::tip renders as an equation`, async ({ page }) => {
			await editor.loadContent(DIRECTIVE);
			await editor.setPresentationMode(mode);

			const widget = directiveBody().locator('.math-inline-widget');
			await expect(widget).toHaveCount(1);
			await expect(widget.locator('.katex')).toHaveCount(1);
			// Rendering is a view of the bytes: the directive's source is untouched.
			expect(await editor.bridge.getSource()).toBe(DIRECTIVE);
			expect(await capturedErrors(page)).toEqual([]);
		});
	}

	test('the same span in a top-level paragraph renders the same way', async () => {
		await editor.loadContent(PARAGRAPH);
		await expect(editor.getBlock(0).locator('.math-inline-widget')).toHaveCount(1);
	});

	test('prices in the same directive stay literal text', async () => {
		await editor.loadContent(PRICES);
		await editor.setPresentationMode('live');

		await expect(editor.page.locator('.math-inline-widget')).toHaveCount(0);
		await expect(directiveBody()).toContainText('$5 and $10, or $10-$20 shipped.');
		expect(await editor.bridge.getSource()).toBe(PRICES);
	});
});
