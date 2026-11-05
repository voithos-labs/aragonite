import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { insertText } from '../../insert-text';
import { attachIme } from '../../simulation/ime';

// Text over a range across blocks that ends at either edge of a picture alone on its line replaces
// the range, by key, by soft keyboard and by IME (requirements/selection/).

const PIC = '![pic](/test-fixtures/sample.png)';
const SOURCE = `alpha\n\nbeta\n\n${PIC}\n`;

interface Range {
	name: string;
	draw(editor: EditorPage): Promise<void>;
	/** Where the drawn range ends, checked before anything is typed. */
	focus: { path: number[]; offset: number };
	/** The document once `Z` replaced the range. */
	after: string;
}

/** A Shift+click in the empty line to the right of the picture, which lands at its end. */
async function shiftClickRightOfPicture(editor: EditorPage): Promise<void> {
	const box = await editor.page.locator('img').boundingBox();
	if (!box) throw new Error('the picture has no box');
	await editor.page.keyboard.down('Shift');
	await editor.page.mouse.click(box.x + box.width + 12, box.y + box.height / 2);
	await editor.page.keyboard.up('Shift');
	await editor.waitForRenderFlush();
}

const RANGES: Range[] = [
	{
		name: 'from the end of alpha to the picture’s end',
		async draw(editor) {
			await editor.clickBlockAtPath([0], 5);
			await shiftClickRightOfPicture(editor);
		},
		focus: { path: [2], offset: PIC.length },
		after: 'alphaZ\n'
	},
	{
		name: 'from the end of alpha to the picture’s start',
		async draw(editor) {
			await editor.clickBlockAtPath([0], 5);
			await editor.shiftClickBlock([2], 0);
		},
		focus: { path: [2], offset: 0 },
		after: `alphaZ${PIC}\n`
	},
	{
		name: 'over the whole document, Ctrl+A twice',
		async draw(editor) {
			await editor.clickBlockAtPath([0], 2);
			await editor.selectAll();
			await editor.selectAll();
		},
		focus: { path: [2], offset: PIC.length },
		after: 'Z\n'
	}
];

const INPUTS: { name: string; send(editor: EditorPage): Promise<void> }[] = [
	{ name: 'a key', send: (editor) => editor.page.keyboard.type('Z') },
	{ name: 'a soft keyboard', send: (editor) => insertText(editor.page, 'Z') },
	{
		name: 'an IME',
		async send(editor) {
			const ime = await attachIme(editor.page);
			await ime.compose('Z');
			await ime.commit('Z');
		}
	}
];

test.describe('text over a range ending at a picture’s edge', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const range of RANGES) {
		test(`${range.name}: every input replaces the range, one undo puts it back`, async () => {
			for (const input of INPUTS) {
				await test.step(input.name, async () => {
					await editor.loadContent(SOURCE);
					await expect(editor.page.locator('img')).toHaveCount(1);
					await range.draw(editor);
					await editor.waitForCrossBlock(true);
					expect((await editor.bridge.getSelection())?.focus).toEqual(range.focus);

					await input.send(editor);
					await editor.bridge.waitForSourceEquals(range.after);
					await editor.waitForCrossBlock(false);

					await editor.undo();
					await editor.bridge.waitForSourceEquals(SOURCE);
				});
			}
		});
	}
});
