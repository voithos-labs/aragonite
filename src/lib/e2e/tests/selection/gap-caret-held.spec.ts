import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { caretsShowing, drawnBar } from '../../carets-showing';
import { FENCE, filler } from './gap-caret-fixtures';
import type { GapCaretPosition } from '../../../selection/gap-caret';

// The gap caret a removal holds where no arrow stops (`requirements/selection/gap-caret-held.md`):
// in a real browser the bar draws, its proxy takes the next key, and a windowed document keeps it.
// The byte rows per route and kind are the unit suite's (`test/range-laws/held-gap.test.ts`).

/** paragraph, fencedCode, then the two paragraphs a range takes: boundary 2 ends the document. */
const TIGHT_END = `intro\n\n${FENCE}last\n\nend\n`;
const HELD: GapCaretPosition = { parentPath: [], index: 2, held: true };
const EMPTIED = `intro\n\n${FENCE}\n`;
const LETTER = `intro\n\n${FENCE}\nq\n`;

/** A range from the first of the last two paragraphs' start to the second's end, by the mouse. */
async function takeLastTwo(editor: EditorPage, first = 2): Promise<void> {
	await editor.clickBlockAtPath([first], 0);
	await editor.shiftClickBlock([first + 1], 3);
	await editor.waitForCrossBlock(true);
}

async function expectBarAtGap(editor: EditorPage, gap: GapCaretPosition): Promise<void> {
	await editor.bridge.waitForGapCaret(gap);
	expect(await editor.bridge.getGapCaret()).toEqual(gap);
	await expect.poll(() => drawnBar(editor.page)).toMatchObject({ state: 'gap', host: 'gap' });
	expect(await caretsShowing(editor.page)).toEqual({ native: false, drawn: 1 });
}

test.describe('a removal that leaves nothing to type into holds the gap caret', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TIGHT_END);
	});

	for (const key of ['Backspace', 'Delete', 'ControlOrMeta+x']) {
		test(`${key} draws the bar under the code block, and a letter opens a paragraph there`, async () => {
			await takeLastTwo(editor);

			await editor.page.keyboard.press(key);

			await expectBarAtGap(editor, HELD);
			expect(await editor.bridge.getSource()).toBe(EMPTIED);
			await editor.typeSlowly('q');
			await editor.bridge.waitForGapCaret(null);
			expect(await editor.bridge.getSource()).toBe(LETTER);
		});
	}

	test('Enter over the range opens an empty paragraph there and leaves the code alone', async () => {
		await takeLastTwo(editor);

		await editor.page.keyboard.press('Enter');
		await editor.typeSlowly('q');

		await editor.bridge.waitForSourceContains('q');
		expect(await editor.bridge.getSource()).toBe(LETTER);
		expect(await editor.bridge.getGapCaret()).toBeNull();
	});

	test('undo takes the letter back to the bar, then the removal; redo holds the bar again', async () => {
		await takeLastTwo(editor);
		await editor.page.keyboard.press('Backspace');
		await expectBarAtGap(editor, HELD);
		await editor.typeSlowly('q');
		await editor.bridge.waitForSourceEquals(LETTER);
		await editor.endTypingBatch();

		await editor.undo();
		await expectBarAtGap(editor, HELD);
		expect(await editor.bridge.getSource()).toBe(EMPTIED);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(TIGHT_END);
		expect(await editor.bridge.getGapCaret()).toBeNull();

		await editor.redo();
		await expectBarAtGap(editor, HELD);
	});

	test('a switch between source and live keeps the bar, and reading ends it', async () => {
		await takeLastTwo(editor);
		await editor.page.keyboard.press('Backspace');
		await expectBarAtGap(editor, HELD);

		await editor.setPresentationMode('live');
		await expectBarAtGap(editor, HELD);
		await editor.setPresentationMode('source');
		await expectBarAtGap(editor, HELD);

		await editor.setPresentationMode('reading');
		await editor.bridge.waitForGapCaret(null);
		await expect(editor.page.locator('[data-gap-caret]')).toHaveCount(0);
	});
});

test.describe('in a windowed document', () => {
	// Long enough that the blocks above the end are unmounted while it shows.
	const BEFORE = 400;
	const LONG = `${filler(BEFORE, 0)}\n${FENCE}last\n\nend\n`;
	const AT_END: GapCaretPosition = { parentPath: [], index: BEFORE + 1, held: true };
	const scrollTop = (editor: EditorPage) =>
		editor.page.evaluate(() => document.querySelector('.editor')!.scrollTop);

	test('the bar draws at the end, survives a scroll away and back, and the letter moves no page', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(LONG);
		const start = { path: [BEFORE + 1], offset: 0 };
		await editor.bridge.setSelection({ anchor: start, focus: start });
		await editor.shiftClickBlock([BEFORE + 2], 3);
		await editor.waitForCrossBlock(true);

		await page.keyboard.press('Backspace');

		await expectBarAtGap(editor, AT_END);
		expect(await page.locator('[data-block-path="[0]"]').count(), 'the top is unmounted').toBe(0);
		const held = await scrollTop(editor);

		await editor.scrollEditorTo(0);
		await expect(page.locator('[data-gap-caret]')).toHaveCount(0);
		expect(await editor.bridge.getGapCaret()).toEqual(AT_END);
		await editor.scrollEditorTo(held);
		await expectBarAtGap(editor, AT_END);

		await editor.typeSlowly('q');
		await editor.bridge.waitForGapCaret(null);
		expect((await editor.bridge.getSource()).endsWith(`${FENCE}\nq\n`)).toBe(true);
		expect(Math.abs((await scrollTop(editor)) - held)).toBeLessThan(40);
	});
});
