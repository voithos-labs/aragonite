import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { countEditEvents } from './helpers';
import { nextRow } from '../../presentation/helpers';
import { edgeKey, extendKey } from '../../../platform-keys';

test.describe('edit events per paste op', () => {
	test('each paste route emits the edit events its ops make', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();

		await test.step('blocks pasted at the end of a list item’s text emit exactly one', async () => {
			await nextRow(editor, '- Item 1\n- Item 2\n');
			const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Item 1' });
			await first.click();
			await editor.page.keyboard.press(edgeKey('lineEnd'));

			await editor.seedClipboard('one\n\ntwo\n');

			const count = await countEditEvents(editor, async () => {
				await editor.paste();
				await editor.bridge.waitForSourceContains('two');
			});

			expect(count).toBe(1);
		});

		await test.step('a list pasted over a list item’s whole text emits exactly one', async () => {
			await nextRow(editor, '- alpha\n- beta\n');
			const second = editor.page.locator('[contenteditable="true"]', { hasText: 'beta' });
			await second.click();
			await editor.page.keyboard.press(edgeKey('lineStart'));
			await editor.page.keyboard.press(extendKey('lineEnd'));

			await editor.seedClipboard('- one\n- two\n');

			const count = await countEditEvents(editor, async () => {
				await editor.paste();
				await editor.bridge.waitForSourceContains('- two');
			});

			expect(count).toBe(1);
		});

		await test.step('a list pasted over a range across two items emits exactly one', async () => {
			await nextRow(editor, '- alpha\n- beta\n');
			const before = await editor.bridge.getSource();
			const first = editor.page.locator('[contenteditable="true"]', { hasText: 'alpha' });
			await first.click();
			await editor.page.keyboard.press(edgeKey('lineEnd'));
			await editor.page.keyboard.press('Shift+ArrowDown');
			await editor.waitForCrossBlock(true);

			await editor.seedClipboard('- x\n- y\n');

			const count = await countEditEvents(editor, async () => {
				await editor.paste();
				await editor.bridge.waitForSourceWith((s, b) => s !== b && s.includes('y'), before);
			});

			expect(count).toBe(1);
		});
	});
});
