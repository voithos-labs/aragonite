// Tab and Shift+Tab over a selection that spans blocks nest or lift the list items it reaches and
// shift the code lines it covers, never delete, and keep the selection for the next press.
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

const SECTION = 'intro\n\nAgreed work\n- alpha\n- beta\n- gamma\n\nLoose ends\n';
const SIBLINGS = '- alpha\n- beta\n- gamma\n';

test.describe('Tab and Shift+Tab over a selection', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	/** Puts the caret at `from`, then shift-clicks `to`, the way a reader draws a range. */
	async function select(from: [number[], number], to: [number[], number]): Promise<void> {
		await editor.focusBlockAtPath(...from);
		await editor.shiftClickBlock(...to);
		await editor.waitForCrossBlock(true);
	}

	test('Shift+Tab over a line and the list below it deletes nothing', async () => {
		await editor.loadContent(SECTION);
		await select([[2, 2, 0], 5], [[1], 0]);

		await editor.pressDeclined('Shift+Tab');

		expect(await editor.bridge.getSource()).toBe(SECTION);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});

	test('Tab over two sibling items nests both, and one undo puts both back', async () => {
		await editor.loadContent(SIBLINGS);
		await select([[0, 1, 0], 1], [[0, 2, 0], 2]);

		await editor.page.keyboard.press('Tab');
		await editor.bridge.waitForSourceEquals('- alpha\n  - beta\n  - gamma\n', 3000);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(SIBLINGS, 3000);
	});

	test('the selection stays, so a second Tab nests the last item again', async () => {
		await editor.loadContent(SIBLINGS);
		await select([[0, 1, 0], 1], [[0, 2, 0], 2]);

		await editor.page.keyboard.press('Tab');
		await editor.bridge.waitForSourceEquals('- alpha\n  - beta\n  - gamma\n', 3000);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
		await editor.page.keyboard.press('Tab');
		await editor.bridge.waitForSourceEquals('- alpha\n  - beta\n    - gamma\n', 3000);
	});

	test('Shift+Tab inside a nested list lifts each item once', async () => {
		await editor.loadContent('- alpha\n  - beta\n  - gamma\n');
		await select([[0, 0, 1, 0, 0], 1], [[0, 0, 1, 1, 0], 3]);

		await editor.page.keyboard.press('Shift+Tab');
		await editor.bridge.waitForSourceEquals('- alpha\n- beta\n- gamma\n', 3000);
	});

	test('Tab from inside a code block down into prose indents the code lines it covers', async () => {
		await editor.loadContent('```\none\ntwo\nthree\n```\n\nafter\n');
		await select([[0], 9], [[1], 3]);

		await editor.page.keyboard.press('Tab');
		await editor.bridge.waitForSourceEquals('```\none\n\ttwo\n\tthree\n```\n\nafter\n', 3000);
	});
});
