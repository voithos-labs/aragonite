import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { edgeKey } from '../../platform-keys';

// Requirements: `e2e/requirements/selection/range-delete-renumber.md`.

const LIST = '8. aa\n9. bb\n10. cc\n11. dd\n';
const MODES = ['source', 'live'] as const;

const GESTURES: { name: string; run: (editor: EditorPage) => Promise<void>; source: string }[] = [
	{
		name: 'Delete',
		run: (e) => e.page.keyboard.press('Delete'),
		source: '8. aa\n9. bcc\n10. dd\n'
	},
	{
		name: 'Backspace',
		run: (e) => e.page.keyboard.press('Backspace'),
		source: '8. aa\n9. bcc\n10. dd\n'
	},
	{
		name: 'Cut',
		run: (e) => e.page.keyboard.press('ControlOrMeta+x'),
		source: '8. aa\n9. bcc\n10. dd\n'
	},
	{ name: 'a typed Z', run: (e) => e.typeSlowly('Z'), source: '8. aa\n9. bZcc\n10. dd\n' },
	{
		name: 'a pasted Z',
		run: async (e) => {
			await e.seedClipboard('Z');
			await e.paste();
		},
		source: '8. aa\n9. bZcc\n10. dd\n'
	}
];

/** The numbers the top-level items show, in document order. */
function shownNumbers(editor: EditorPage): Promise<string[]> {
	return editor.page.evaluate(() =>
		[...document.querySelectorAll('.editor .list-item-marker')].map((m) => m.textContent!.trim())
	);
}

/** Extends the placed caret with Shift and each key in turn. */
async function extend(editor: EditorPage, keys: string[]): Promise<void> {
	for (const key of keys) await editor.page.keyboard.press(`Shift+${key}`);
	await editor.waitForCrossBlock(true);
}

test.describe('a range removal keeps the ordered list’s numbers', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const mode of MODES) {
		for (const gesture of GESTURES) {
			test(`${gesture.name} over a middle item into the next (${mode})`, async () => {
				await editor.setPresentationMode(mode);
				await editor.loadContent(LIST);
				await editor.focusBlockAtPath([0, 1, 0], 1);
				await extend(editor, [edgeKey('lineEnd'), 'ArrowRight']);

				await gesture.run(editor);

				await expect.poll(() => editor.bridge.getSource()).toBe(gesture.source);
				await expect.poll(() => shownNumbers(editor)).toEqual(['8.', '9.', '10.']);
				expect(await editor.parseConverged()).toBe(true);
			});
		}

		test(`Delete from a paragraph above into the second item keeps the start (${mode})`, async () => {
			await editor.setPresentationMode(mode);
			await editor.loadContent('pp\n\n8. aa\n9. bb\n10. cc\n');
			await editor.focusBlockAtPath([1, 1, 0], 1);
			await editor.shiftClickBlock([0], 1);
			await editor.waitForCrossBlock(true);
			expect(await editor.bridge.getSelection()).toEqual({
				anchor: { path: [1, 1, 0], offset: 1 },
				focus: { path: [0], offset: 1 }
			});

			await editor.page.keyboard.press('Delete');

			await expect.poll(() => editor.bridge.getSource()).toBe('pb\n\n8. cc\n');
			await expect.poll(() => shownNumbers(editor)).toEqual(['8.']);
			expect(await editor.parseConverged()).toBe(true);
		});
	}

	// A list whose first two numbers match counts by 0, so a removal leaves its numbers alone.
	for (const n of ['1', '0']) {
		for (const gesture of GESTURES.filter((g) => g.name === 'Delete' || g.name === 'Cut')) {
			test(`${gesture.name} over a middle item of a list of ${n}s keeps every ${n}`, async () => {
				await editor.loadContent(LIST.replace(/^\d+\./gm, `${n}.`));
				await editor.focusBlockAtPath([0, 1, 0], 1);
				await extend(editor, [edgeKey('lineEnd'), 'ArrowRight']);

				await gesture.run(editor);

				await expect
					.poll(() => editor.bridge.getSource())
					.toBe(gesture.source.replace(/^\d+\./gm, `${n}.`));
			});
		}
	}
});
