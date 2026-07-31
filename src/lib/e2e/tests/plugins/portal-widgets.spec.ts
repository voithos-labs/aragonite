import { test, expect } from '../../fixtures';
import { PluginsPage, clickWidgetCenter } from './helpers';

/**
 * The component-portal seam guarantee: a keyed reuse pool keeps one live instance per `(kind,
 * source)` across the editor's rebuild-everything-per-keystroke render. `MathInline`'s
 * `data-mount-id` is the oracle — stable when a widget is adopted (unchanged source), new when it
 * is remounted (source edited). Only a real browser proves it: the pool, the mount, and the render
 * survival are all runtime.
 */

class PortalPage extends PluginsPage {
	get mathWidget() {
		return this.page.locator('.math-inline-widget');
	}

	async mountId(nth = 0): Promise<string> {
		const id = await this.mathWidget.nth(nth).getAttribute('data-mount-id');
		if (id === null) throw new Error('math widget carries no data-mount-id');
		return id;
	}
}

test.describe('component-portal inline widgets', () => {
	test('adoption: typing next to a widget keeps its mount id and its render', async ({ page }) => {
		const editor = new PortalPage(page);
		await editor.gotoPlugins('math');
		await expect(editor.mathWidget).toHaveCount(1);
		const idBefore = await editor.mountId();

		// Type in the same paragraph, past the widget — the widget's source is untouched.
		await editor.focusBlockEnd(0);
		await editor.typeSlowly('Z');
		await editor.bridge.waitForSourceContains('afterZ');
		await editor.waitForRenderFlush();

		await expect(editor.mathWidget).toHaveCount(1);
		// THE seam guarantee: the instance was adopted, not remounted.
		expect(await editor.mountId()).toBe(idBefore);
		await expect(editor.mathWidget.locator('.katex')).toHaveCount(1);
	});

	test('source edit: reveal → edit → commit remounts the widget with the new formula', async ({
		page
	}) => {
		const editor = new PortalPage(page);
		await editor.gotoPlugins('math');
		await expect(editor.mathWidget).toHaveCount(1);
		const idBefore = await editor.mountId();

		await clickWidgetCenter(editor.mathWidget);
		await expect(editor.mathWidget).toHaveCount(0);
		// Step past the opening `$`, insert inside the formula, then walk the caret out
		// of the source — the gesture that folds an edited reveal.
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('y');
		await page.keyboard.press('End');

		await expect(editor.mathWidget).toHaveCount(1);
		await editor.bridge.waitForSourceContains('$yx^2$');
		await expect(editor.mathWidget.locator('.katex')).toHaveCount(1);
		// Source changed → a fresh instance, so a new id (never the adopted one).
		expect(await editor.mountId()).not.toBe(idBefore);
	});

	test('reveal → Escape restores the rendered widget through the portal route', async ({
		page
	}) => {
		const editor = new PortalPage(page);
		await editor.gotoPlugins('math');
		await expect(editor.mathWidget).toHaveCount(1);

		await clickWidgetCenter(editor.mathWidget);
		await expect(editor.mathWidget).toHaveCount(0);
		await page.keyboard.press('Escape');

		// The cancel swap re-inserts the exact detached element — a portal kind must
		// fold back without a builder-less throw (pageerror fails the fixture watcher).
		await expect(editor.mathWidget).toHaveCount(1);
		await expect(editor.mathWidget.locator('.katex')).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain('Before $x^2$ after');
	});

	test('repeated reveal → Escape keeps the mount id stable (no out-of-pass duplicate)', async ({
		page
	}) => {
		const editor = new PortalPage(page);
		await editor.gotoPlugins('math');
		await expect(editor.mathWidget).toHaveCount(1);
		const idBefore = await editor.mountId();

		// Two reveal→cancel cycles with no render between. The cancel swap restores the exact
		// detached element, so no pool state is disturbed and no duplicate can mount — the id must
		// hold through both cycles and the next real render.
		for (let cycle = 0; cycle < 2; cycle++) {
			await clickWidgetCenter(editor.mathWidget);
			await expect(editor.mathWidget).toHaveCount(0);
			await page.keyboard.press('Escape');
			await expect(editor.mathWidget).toHaveCount(1);
			expect(await editor.mountId()).toBe(idBefore);
		}

		await editor.focusBlockEnd(0);
		await editor.typeSlowly('Z');
		await editor.bridge.waitForSourceContains('afterZ');
		await editor.waitForRenderFlush();
		expect(await editor.mountId()).toBe(idBefore);
		await expect(editor.mathWidget.locator('.katex')).toHaveCount(1);
	});

	test('duplicate identical widgets: revealing the second and Escape restores BOTH in place', async ({
		page
	}) => {
		const editor = new PortalPage(page);
		await editor.gotoPlugins('math');
		// Two byte-identical formulas in one paragraph — one pool bucket, two instances.
		await editor.loadContent('Twice $x^2$ and $x^2$ again\n\nNext\n');
		await expect(editor.mathWidget).toHaveCount(2);
		const firstId = await editor.mountId(0);
		const secondId = await editor.mountId(1);
		expect(firstId).not.toBe(secondId);

		// Reveal the SECOND widget, then Escape. A key-only fold-back lookup returns the oldest
		// pooled instance, and replaceWith MOVES the first widget's element into the second's slot
		// — the first formula vanishes and the DOM diverges from the CST.
		await clickWidgetCenter(editor.mathWidget.nth(1));
		await expect(editor.mathWidget).toHaveCount(1);
		await page.keyboard.press('Escape');

		await expect(editor.mathWidget).toHaveCount(2);
		// Identity-exact restore: each widget keeps its own instance, in document order.
		expect(await editor.mountId(0)).toBe(firstId);
		expect(await editor.mountId(1)).toBe(secondId);
		await expect(editor.mathWidget.locator('.katex')).toHaveCount(2);
		// Byte-stable: the cancel touched no source.
		expect(await editor.bridge.getSource()).toContain('Twice $x^2$ and $x^2$ again');
	});

	test('table cell: a widget renders and keeps its mount id while typing in the cell', async ({
		page
	}) => {
		const editor = new PortalPage(page);
		await editor.gotoPlugins('mathtable');
		await expect(editor.mathWidget).toHaveCount(1);
		const idBefore = await editor.mountId();

		// The cell render surface is pooled too — type after the cell's widget.
		const cell = page.locator('.table-cell', { has: editor.mathWidget });
		await cell.click();
		await page.keyboard.press('End');
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('x^2$Z');
		await editor.waitForRenderFlush();

		await expect(editor.mathWidget).toHaveCount(1);
		expect(await editor.mountId()).toBe(idBefore);
		await expect(editor.mathWidget.locator('.katex')).toHaveCount(1);
	});
});
