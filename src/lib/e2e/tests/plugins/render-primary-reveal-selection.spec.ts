import { test, expect } from '../../fixtures';
import { PluginsPage, clickWidgetCenter } from './helpers';

// A reveal click is a caret-placing gesture
// (requirements/plugins/render-primary-reveal-selection.md). It reached the reveal without the
// pointerdown reset every other caret-placing gesture runs, so a live cross-block range stayed
// painted over the caret it had just landed elsewhere — and the next Backspace deleted the range
// instead of a character.

const DOC = 'lead para\n\n$$x^2$$\n\ntail para\n';

test.describe('render-primary reveal click vs a live cross-block range', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('latex');
		await editor.loadContent(DOC);
		await editor.page.locator('[contenteditable="true"]').first().click();
		await editor.page.keyboard.press('Control+a');
		await editor.page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);
	});

	const math = () => editor.page.locator('[data-block-kind="mathBlock"]').first();

	test('the click ends the range, so Backspace edits the source instead of the document', async ({
		page
	}) => {
		await clickWidgetCenter(math());
		await editor.waitForCrossBlock(false);

		// What Backspace does to the revealed source is the reveal's business; what it
		// must not do is consume the range — that collapses the whole document to "\n".
		await page.keyboard.press('Backspace');
		await editor.waitForNoSourceMutation();

		const source = await editor.bridge.getSource();
		expect(source).toContain('lead para');
		expect(source).toContain('tail para');
	});

	test('shift+click still extends rather than resetting', async () => {
		await math().click({ modifiers: ['Shift'], position: { x: 8, y: 8 } });
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});
});
