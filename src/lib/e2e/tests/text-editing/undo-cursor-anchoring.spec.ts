import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';

test.describe('undo cursor anchoring', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('C2: undo after typing returns caret to pre-edit position', async () => {
		await editor.loadContent('Hello\n');
		await editor.focusBlockStart(0);
		await editor.typeSlowly('XYZ');
		await editor.bridge.waitForSourceContains('XYZHello');
		await editor.undo();
		await editor.bridge.waitForSourceEquals('Hello\n');
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!Hello');
		const source = await editor.bridge.getSource();
		expect(source.startsWith('!Hello')).toBe(true);
	});

	test('C3: undo after Ctrl+1 heading returns caret to pre-edit position', async () => {
		await editor.loadContent('Title\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press(`${primaryModifier}+1`);
		await editor.bridge.waitForSourceMatches(/^# Title$/m);
		await editor.undo();
		await editor.bridge.waitForSourceEquals('Title\n');
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!Title');
		const source = await editor.bridge.getSource();
		expect(source.startsWith('!Title')).toBe(true);
	});
});
