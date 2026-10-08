import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Each row selects a run with Shift+ArrowRight from a raw offset, then applies one chord: the
// toggle wraps the run or strips the delimiters already around it. Splitting a construct and
// absorbing neighbouring runs are pinned in `format-toggle-coverage.test.ts`.
const TOGGLES = [
	{
		chord: 'Ctrl+B',
		effect: 'wraps selection with **',
		doc: 'Hello world\n',
		offset: 6,
		extend: 5,
		press: 'ControlOrMeta+b',
		expected: 'Hello **world**'
	},
	{
		chord: 'Ctrl+B',
		effect: 'on already-bold text removes **',
		doc: 'Hello **world**\n',
		offset: 6,
		extend: 9,
		press: 'ControlOrMeta+b',
		expected: 'Hello world',
		forbidden: '**'
	},
	{
		chord: 'Ctrl+B',
		effect: 'over a bold run and the space beside it removes **',
		doc: 'Hello **world** today\n',
		offset: 5,
		extend: 10,
		press: 'ControlOrMeta+b',
		expected: 'Hello world today',
		forbidden: '**'
	},
	{
		chord: 'Ctrl+I',
		effect: 'wraps selection with *',
		doc: 'Hello world\n',
		offset: 6,
		extend: 5,
		press: 'ControlOrMeta+i',
		expected: 'Hello *world*'
	},
	{
		chord: 'Ctrl+I',
		effect: 'on already-italic text removes *',
		doc: 'Hello *world*\n',
		offset: 6,
		extend: 7,
		press: 'ControlOrMeta+i',
		expected: 'Hello world',
		forbidden: '*'
	}
];

test.describe('inline editing, formatting shortcuts', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	async function selectAndPress(
		doc: string,
		offset: number,
		extend: number,
		chord: string
	): Promise<void> {
		await editor.loadContent(doc);
		await editor.focusBlock(0, offset);
		for (let i = 0; i < extend; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}
		await editor.page.keyboard.press(chord);
	}

	for (const { chord, effect, doc, offset, extend, press, expected, forbidden } of TOGGLES) {
		test(`${chord} ${effect}`, async () => {
			await selectAndPress(doc, offset, extend, press);

			await editor.bridge.waitForSourceContains(expected);
			if (forbidden) expect(await editor.bridge.getSource()).not.toContain(forbidden);
		});
	}

	test('Ctrl+B on word flanked by markers strips them rather than double-wrapping', async () => {
		await selectAndPress('Hello **world** today\n', 8, 5, 'ControlOrMeta+b');

		await editor.bridge.waitForSourceContains('Hello world today');
		expect(await editor.bridge.getSource()).not.toContain('****');
	});
});
