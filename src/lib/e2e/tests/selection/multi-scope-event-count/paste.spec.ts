import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { countEditEvents } from './helpers';

test.describe('edit events per paste op', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('nested paste of multi-block content inside a list item emits exactly one edit event', async () => {
		await editor.loadContent('- Item 1\n- Item 2\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Item 1' });
		await first.click();
		await editor.page.keyboard.press('End');

		await editor.seedClipboard('one\n\ntwo\n');

		const count = await countEditEvents(editor, async () => {
			await editor.page.keyboard.press('ControlOrMeta+KeyV');
			await editor.bridge.waitForSourceContains('two');
		});

		expect(count).toBe(1);
	});

	test('container-matching paste into list with empty target emits exactly one edit event', async () => {
		await editor.loadContent('- alpha\n- beta\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'beta' });
		await second.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+End');

		await editor.seedClipboard('- one\n- two\n');

		const count = await countEditEvents(editor, async () => {
			await editor.page.keyboard.press('ControlOrMeta+KeyV');
			await editor.bridge.waitForSourceContains('- two');
		});

		expect(count).toBe(1);
	});

	test('container-matching merge over a non-empty cross-block target emits exactly two edit events', async () => {
		await editor.loadContent('- alpha\n- beta\n');
		const before = await editor.bridge.getSource();
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'alpha' });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.seedClipboard('- x\n- y\n');

		const count = await countEditEvents(editor, async () => {
			await editor.page.keyboard.press('ControlOrMeta+KeyV');
			await editor.bridge.waitForSourceWith((s, b) => s !== b && s.includes('y'), before);
		});

		// cross-block delete + merge-paste each emit one event
		expect(count).toBe(2);
	});
});
