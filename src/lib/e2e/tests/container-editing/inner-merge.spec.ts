import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('inner container+paragraph merge inside a container', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace in trailing paragraph inside blockquote merges into deepest prose leaf of preceding nested blockquote', async () => {
		await editor.loadContent('> one\n>\n> > nested\n>\n> three\n');
		const three = editor.page.locator('[contenteditable="true"]', { hasText: /^three$/ });
		await three.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/nestedthree/);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/nestedthree/);
		expect(source).toMatch(/^> one$/m);
		expect(source).not.toMatch(/^three$/m);
		expect(source).not.toMatch(/^> three$/m);
	});

	test('caret lands at the join point inside the merged blockquote leaf (not at container end)', async () => {
		await editor.loadContent('> > nested\n>\n> trailing\n');
		const trailing = editor.page.locator('[contenteditable="true"]', { hasText: /^trailing$/ });
		await trailing.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/nestedtrailing/);
		await editor.typeText('!');
		await editor.bridge.waitForSourceMatches(/nested!trailing/);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/nested!trailing/);
		expect(source).not.toMatch(/nestedtrailing!/);
	});

	test('caret lands at the join point when merge target is two containers deep', async () => {
		// A 2-level-deep nested blockquote beside a trailing paragraph, so the Backspace exercises
		// `focusByPath`'s `path.length === 2` branch inside the nested merge path.
		await editor.loadContent('> > > deep\n>\n> trailing\n');
		const trailing = editor.page.locator('[contenteditable="true"]', { hasText: /^trailing$/ });
		await trailing.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/deeptrailing/);
		await editor.typeText('!');
		await editor.bridge.waitForSourceMatches(/deep!trailing/);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/deep!trailing/);
		expect(source).not.toMatch(/deeptrailing!/);
	});

	test('caret lands at the join point when prev sibling is a list inside a blockquote', async () => {
		await editor.loadContent('> - item\n>\n> trailing\n');
		const trailing = editor.page.locator('[contenteditable="true"]', { hasText: /^trailing$/ });
		await trailing.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/itemtrailing/);
		await editor.typeText('!');
		await editor.bridge.waitForSourceMatches(/item!trailing/);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/item!trailing/);
		expect(source).not.toMatch(/itemtrailing!/);
	});

	test('caret lands at the join point when prev sibling is a list inside a list item', async () => {
		await editor.loadContent('- outer\n\n  - inner\n\n  trailing\n');
		const trailing = editor.page.locator('[contenteditable="true"]', { hasText: /^trailing$/ });
		await trailing.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/innertrailing/);
		await editor.typeText('!');
		await editor.bridge.waitForSourceMatches(/inner!trailing/);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/inner!trailing/);
		expect(source).not.toMatch(/innertrailing!/);
	});
});
