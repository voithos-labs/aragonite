import { test, expect } from '../../fixtures';
import { clickWidgetCenter, clickWidgetEnd } from './helpers';
import { MathRevealPage } from './latex-reveal-helpers';

/**
 * What mounting a component into the text promises: a keyed pool keeps one live instance per
 * `(kind, source)` across a render that rebuilds everything on every keystroke. `MathInline`'s
 * `data-mount-id` is what the tests read: unchanged when a widget is reused with the same source,
 * new when it is remounted after the source was edited. Only a real browser can prove it, since
 * the pool, the mount and surviving the render all happen at runtime.
 */

class PortalPage extends MathRevealPage {
	async mountId(nth = 0): Promise<string> {
		const id = await this.mathWidget.nth(nth).getAttribute('data-mount-id');
		if (id === null) throw new Error('math widget carries no data-mount-id');
		return id;
	}
}

test.describe('component-portal inline widgets', () => {
	let editor: PortalPage;

	test.beforeEach(async ({ page }) => {
		editor = new PortalPage(page);
		await editor.gotoPlugins('math');
		await expect(editor.mathWidget).toHaveCount(1);
	});

	test('adoption: typing next to a widget keeps its mount id and its render', async () => {
		const idBefore = await editor.mountId();

		// Type in the same paragraph, past the widget, so the widget's source is untouched.
		await editor.focusBlockEnd(0);
		await editor.typeSlowly('Z');
		await editor.bridge.waitForSourceContains('afterZ');
		await editor.waitForRenderFlush();

		await expect(editor.mathWidget).toHaveCount(1);
		// The promise itself: the instance was reused, not remounted.
		expect(await editor.mountId()).toBe(idBefore);
		await expect(editor.mathWidget.locator('.katex')).toHaveCount(1);
	});

	test('source edit: reveal → edit → commit remounts the widget with the new formula', async ({
		page
	}) => {
		const idBefore = await editor.mountId();

		await clickWidgetEnd(editor.mathWidget);
		await expect(editor.mathWidget).toHaveCount(0);
		// Clicked at the formula's end, so the caret sits inside the closing `$`: insert there,
		// then step the caret out of the source, which is what commits an edited one.
		await page.keyboard.type('y');
		await page.keyboard.press('End');

		await expect(editor.mathWidget).toHaveCount(1);
		await editor.bridge.waitForSourceContains('$x^2y$');
		await expect(editor.mathWidget.locator('.katex')).toHaveCount(1);
		// The source changed, so a fresh instance with a new id, never the reused one.
		expect(await editor.mountId()).not.toBe(idBefore);
	});

	test('reveal → Escape restores the rendered widget through the portal route', async ({
		page
	}) => {
		await clickWidgetCenter(editor.mathWidget);
		await expect(editor.mathWidget).toHaveCount(0);
		await page.keyboard.press('Escape');

		// Cancelling puts the exact detached element back, so a kind mounted this way must render
		// again without throwing for want of a builder, which the fixture's watcher fails on.
		await expect(editor.mathWidget).toHaveCount(1);
		await expect(editor.mathWidget.locator('.katex')).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain('Before $x^2$ after');
	});

	test('repeated reveal → Escape keeps the mount id stable (no out-of-pass duplicate)', async ({
		page
	}) => {
		const idBefore = await editor.mountId();

		// Two open-then-cancel cycles with no render between. Cancelling restores the exact
		// detached element, so the pool is left alone and no duplicate can mount: the id must hold
		// through both cycles and the next real render.
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

	test('duplicate identical widgets: revealing the second and Escape restores both in place', async ({
		page
	}) => {
		// Two byte-identical formulas in one paragraph: one pool entry, two instances.
		await editor.loadContent('Twice $x^2$ and $x^2$ again\n\nNext\n');
		await expect(editor.mathWidget).toHaveCount(2);
		const firstId = await editor.mountId(0);
		const secondId = await editor.mountId(1);
		expect(firstId).not.toBe(secondId);

		// Open the second widget, then Escape. Looking the instance up by key alone returns the
		// oldest one in the pool, and replaceWith moves the first widget's element into the
		// second's place, so the first formula disappears and the DOM no longer matches the CST.
		await clickWidgetCenter(editor.mathWidget.nth(1));
		await expect(editor.mathWidget).toHaveCount(1);
		await page.keyboard.press('Escape');

		await expect(editor.mathWidget).toHaveCount(2);
		// Restored exactly: each widget keeps its own instance, in document order.
		expect(await editor.mountId(0)).toBe(firstId);
		expect(await editor.mountId(1)).toBe(secondId);
		await expect(editor.mathWidget.locator('.katex')).toHaveCount(2);
		// The bytes did not move: cancelling touched no source.
		expect(await editor.bridge.getSource()).toContain('Twice $x^2$ and $x^2$ again');
	});

	test('table cell: a widget renders and keeps its mount id while typing in the cell', async ({
		page
	}) => {
		await editor.gotoPlugins('mathtable');
		await expect(editor.mathWidget).toHaveCount(1);
		const idBefore = await editor.mountId();

		// A table cell's render uses the same pool, so type after the cell's widget.
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
