import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { PluginsPage } from '../plugins/helpers';

// The order a `selectionChange` subscriber sees: the caret's arrival in a block, then the bytes
// typed there (`requirements/selection/landing-announced-before-input.md`).

const PROSE = 'alpha one\n\nbravo two\n\ncharlie three\n';
const LIST = '- alpha\n- bravo\n- charlie\n';
const TYPED = 'z';
const CYCLES = 5;

interface Emission {
	focus: { path: number[]; offset: number } | null;
	raw: string | null;
}

const startCapture = (editor: EditorPage) =>
	editor.page.evaluate(() => (window as any).__test.startSelectionChangeCapture());

const stopCapture = (editor: EditorPage): Promise<Emission[]> =>
	editor.page.evaluate(() => (window as any).__test.stopSelectionChangeCapture() as Emission[]);

/**
 * What the subscriber heard first about the caret arriving at `path`. A phrase rather than a
 * boolean, so a failure names which of the two ways it went wrong.
 */
function arrivalVerdict(emissions: Emission[], path: number[]): string {
	const key = JSON.stringify(path);
	const first = emissions.find((e) => JSON.stringify(e.focus?.path ?? null) === key);
	if (!first) return `${key}: never announced`;
	if (first.raw?.includes(TYPED)) return `${key}: announced after the typed byte`;
	return `${key}: announced before the typed byte`;
}

const before = (path: number[]) => `${JSON.stringify(path)}: announced before the typed byte`;

test.describe('a caret the editor lands is announced before the next input', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('the paragraph an Enter creates is announced empty', async () => {
		await editor.loadContent(PROSE);
		await editor.focusBlockEnd(0);
		await startCapture(editor);

		for (let i = 0; i < CYCLES; i++) {
			await editor.page.keyboard.press('Enter');
			await editor.page.keyboard.insertText(TYPED);
		}
		await editor.waitForRenderFlush();

		const created = Array.from({ length: CYCLES }, (_, i) => [i + 1]);
		const emissions = await stopCapture(editor);
		expect(created.map((path) => arrivalVerdict(emissions, path))).toEqual(created.map(before));
	});

	// A list item lands its own caret, past the marker prefix the item draws, so the nested
	// path and the offset both differ from the top-level split above.
	test('the list item an Enter creates is announced empty', async () => {
		await editor.loadContent(LIST);
		await editor.focusBlockAtPath([0, 0, 0], 'alpha'.length);
		await startCapture(editor);

		for (let i = 0; i < CYCLES; i++) {
			await editor.page.keyboard.press('Enter');
			await editor.page.keyboard.insertText(TYPED);
		}
		await editor.waitForRenderFlush();

		const created = Array.from({ length: CYCLES }, (_, i) => [0, i + 1, 0]);
		const emissions = await stopCapture(editor);
		expect(created.map((path) => arrivalVerdict(emissions, path))).toEqual(created.map(before));
	});

	// The vertical arrow lands by pixel column, a placement of its own rather than the one every
	// other caret goes through, so it needs its own scenario.
	test('the block an ArrowDown lands in is announced without the typed byte', async () => {
		await editor.loadContent(PROSE);
		await editor.focusBlockStart(0);
		await startCapture(editor);

		const arrived = [[1], [2]];
		for (let i = 0; i < arrived.length; i++) {
			await editor.page.keyboard.press('ArrowDown');
			await editor.page.keyboard.insertText(TYPED);
		}
		await editor.waitForRenderFlush();

		const emissions = await stopCapture(editor);
		expect(arrived.map((path) => arrivalVerdict(emissions, path))).toEqual(arrived.map(before));
	});
});

// A plugin leaf shows its source before a caret can go in it, so the placement has nothing to
// report yet and the arrival comes from the browser instead. It still has to reach a subscriber
// before the byte typed there, which is what the announcer's skip-a-repeat rule could break.
test.describe('a caret landing in a plugin leaf with its source hidden', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		// Seeds Before / $$x^2$$ / After, with the equation rendered rather than open.
		await editor.gotoPlugins('mathblock');
		await expect(page.locator('.math-block-render .katex')).toHaveCount(1);
	});

	test('is announced before the byte typed into the source it opens', async () => {
		await editor.focusBlockEnd(0);
		await startCapture(editor);

		await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.insertText(TYPED);
		await editor.waitForRenderFlush();

		const emissions = await stopCapture(editor);
		expect(arrivalVerdict(emissions, [1])).toBe(before([1]));
	});
});
