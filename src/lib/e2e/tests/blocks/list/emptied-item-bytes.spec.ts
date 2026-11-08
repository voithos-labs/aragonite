import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { extendKey } from '../../../platform-keys';

// Requirements: `e2e/requirements/blocks/list/emptied-item-bytes.md`.

const ROUTES = [
	{ name: 'Backspace', key: 'Backspace' },
	{ name: 'Delete', key: 'Delete' },
	{ name: 'a cut', key: 'ControlOrMeta+x' }
] as const;

async function selectLeafText(editor: EditorPage, path: number[]): Promise<void> {
	await editor.focusBlockAtPath(path, 0);
	await editor.page.keyboard.press(extendKey('lineEnd'));
}

/** Opens the editor's own source as a fresh document, the way saving and reopening the file would. */
async function reload(editor: EditorPage): Promise<void> {
	await editor.loadContent(await editor.bridge.getSource());
}

// Live mode keeps the hidden markers around a deleted run of bold text, so it deletes plain text.
const MODES = [
	{ mode: 'source', loaded: '- **a**' },
	{ mode: 'live', loaded: '- a' }
] as const;

for (const { mode, loaded } of MODES) {
	test.describe(`deleting the last item's only text, ${mode} mode`, () => {
		for (const route of ROUTES) {
			test(`${route.name} keeps the bullet in the source`, async ({ page }) => {
				const editor = new EditorPage(page);
				await editor.goto(`?presentationMode=${mode}`);
				await editor.loadContent(loaded);
				await selectLeafText(editor, [0, 0, 0]);

				await page.keyboard.press(route.key);

				await editor.bridge.waitForSourceEquals('- ');
				await editor.waitForListItemCount(1);
				await reload(editor);
				await editor.waitForListItemCount(1);
				await editor.focusBlockAtPath([0, 0, 0], 0);
				await page.keyboard.type('y');
				await editor.bridge.waitForSourceEquals('- y');
			});
		}
	});
}

test.describe('deleting the last text of other emptied containers', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('the second item keeps its bullet', async ({ page }) => {
		await editor.loadContent('- a\n- b');
		await selectLeafText(editor, [0, 1, 0]);

		await page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceEquals('- a\n- ');
		await reload(editor);
		await editor.waitForListItemCount(2);
	});

	test('joining the item above an emptied one keeps the emptied one typeable', async ({ page }) => {
		await editor.loadContent('- a\n- b\n- c');
		await selectLeafText(editor, [0, 2, 0]);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('- a\n- b\n- ');
		await editor.focusBlockAtPath([0, 1, 0], 0);

		await page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceEquals('- ab\n- ');
		await editor.waitForListItemCount(2);
		await reload(editor);
		await editor.waitForListItemCount(2);
		await editor.focusBlockAtPath([0, 1, 0], 0);
		await page.keyboard.type('y');
		await editor.bridge.waitForSourceEquals('- ab\n- y');
	});

	test('a task item keeps its checkbox', async ({ page }) => {
		await editor.loadContent('- [ ] a');
		await selectLeafText(editor, [0, 0, 0]);

		await page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceEquals('- [ ] ');
		await reload(editor);
		await editor.waitForListItemCount(1);
		await expect(page.locator('.task-checkbox')).toHaveCount(1);
	});

	test('a quote keeps its marker', async ({ page }) => {
		await editor.loadContent('> a');
		await selectLeafText(editor, [0, 0]);

		await page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceEquals('> ');
		await reload(editor);
		expect(await editor.bridge.getBlockKind(0)).toBe('blockquote');
	});
});
