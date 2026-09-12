import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { PluginsPage } from '../plugins/helpers';

/**
 * A drag inside a block with no character position selects it whole, and every destructive
 * gesture over that range goes through the range door
 * (requirements/selection/whole-unit-range.md). Focus parks on the editor root, so the root's
 * own arms are the only ones a keystroke or a clipboard event can reach.
 * Miss-analysis: the existing coverage pinned Backspace and the copy bytes; nothing typed a
 * character over such a range, and nothing asked where a pasted block landed.
 */

const DOC = 'above\n\n---\n\nbelow\n';

/** A held sweep across the block's middle: the unit joins the range the moment the pointer moves. */
async function dragInside(editor: EditorPage, selector: string): Promise<void> {
	const box = await editor.page.locator(selector).boundingBox();
	if (!box) throw new Error(`no box for ${selector}`);
	const y = box.y + box.height / 2;
	await editor.page.mouse.move(box.x + 8, y);
	await editor.page.mouse.down();
	await editor.page.mouse.move(box.x + box.width - 8, y, { steps: 8 });
	await editor.page.mouse.up();
	await editor.waitForCrossBlock(true);
}

test.describe('a whole-unit range — thematic break', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
	});

	test('a printable key replaces the rule with a paragraph holding the character', async () => {
		await dragInside(editor, '.thematic-break-block');

		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceEquals('above\n\nx\n\nbelow\n');

		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);

		// The caret sits after the character it landed, not at the block's head.
		await editor.typeSlowly('y');
		await editor.bridge.waitForSourceEquals('above\n\nxy\n\nbelow\n');
	});

	test('one undo restores the rule after a typed character', async () => {
		await dragInside(editor, '.thematic-break-block');
		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceContains('\nx\n');

		await editor.undo();
		await editor.bridge.waitForSourceEquals(DOC);
	});

	test('a paste replaces the rule with the clipboard', async () => {
		await editor.seedClipboard('pasted');
		await dragInside(editor, '.thematic-break-block');

		await editor.paste();
		await editor.bridge.waitForSourceEquals('above\n\npasted\n\nbelow\n');
		expect(await editor.bridge.getBlockCount()).toBe(3);
	});

	test('a cut writes the rule to the clipboard and takes it out of the document', async () => {
		await dragInside(editor, '.thematic-break-block');

		await editor.page.keyboard.press('ControlOrMeta+x');
		await editor.bridge.waitForSourceEquals('above\n\nbelow\n');
		expect(await editor.readClipboard()).toBe('---');

		await editor.undo();
		await editor.bridge.waitForSourceEquals(DOC);
	});
});

test.describe('a whole-unit range — block math', () => {
	test('a cut writes the equation to the clipboard and takes it out', async ({ page }) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('mathblock');
		await editor.loadContent('above\n\n$$x^2$$\n\nbelow\n');

		await dragInside(editor, '.math-block-render');

		await editor.page.keyboard.press('ControlOrMeta+x');
		await editor.bridge.waitForSourceEquals('above\n\nbelow\n');
		expect(await editor.readClipboard()).toBe('$$x^2$$');
	});
});
