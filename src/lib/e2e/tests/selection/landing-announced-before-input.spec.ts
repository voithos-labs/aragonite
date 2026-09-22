import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { PluginsPage } from '../plugins/helpers';

// The order a `selectionChange` subscriber sees: the caret's arrival in a block, then the bytes
// typed there (`requirements/selection/landing-announced-before-input.md`).

const PROSE = 'alpha one\n\nbravo two\n\ncharlie three\n';
const LIST = '- alpha\n- bravo\n- charlie\n';
const TYPED = 'z';
const CYCLES = 5;
// What a block a split just created holds, top level and list item alike.
const EMPTY = '\n';

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
 * boolean, so a failure names which of the two ways it went wrong. `rawBefore` is the whole of
 * the block's source before the byte goes in: searching the payload for the byte instead would
 * read as late on any fixture that already holds one.
 */
function arrivalVerdict(emissions: Emission[], path: number[], rawBefore: string): string {
	const key = JSON.stringify(path);
	const first = emissions.find((e) => namesPath(e, path));
	if (!first) return `${key}: never announced`;
	if (first.raw !== rawBefore) return `${key}: announced after the typed byte`;
	return `${key}: announced before the typed byte`;
}

const namesPath = (emission: Emission, path: number[]) =>
	JSON.stringify(emission.focus?.path ?? null) === JSON.stringify(path);

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
		expect(created.map((path) => arrivalVerdict(emissions, path, EMPTY))).toEqual(
			created.map(before)
		);
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
		expect(created.map((path) => arrivalVerdict(emissions, path, EMPTY))).toEqual(
			created.map(before)
		);
	});

	// The vertical arrow lands by pixel column, a placement of its own rather than the one every
	// other caret goes through, so it needs its own scenario.
	test('the block an ArrowDown lands in is announced without the typed byte', async () => {
		await editor.loadContent(PROSE);
		await editor.focusBlockStart(0);
		await startCapture(editor);

		const arrived: [number[], string][] = [
			[[1], 'bravo two\n'],
			[[2], 'charlie three\n']
		];
		for (let i = 0; i < arrived.length; i++) {
			await editor.page.keyboard.press('ArrowDown');
			await editor.page.keyboard.insertText(TYPED);
		}
		await editor.waitForRenderFlush();

		const emissions = await stopCapture(editor);
		expect(arrived.map(([path, raw]) => arrivalVerdict(emissions, path, raw))).toEqual(
			arrived.map(([path]) => before(path))
		);
	});

	// The browser places a click's caret and reports it a task later, which the byte a script or
	// a fast typist sends next can beat. No render flush between the click and the byte: a flush
	// hands that report its turn, and then the race never happens.
	test('the list item a click lands in is announced before the byte typed there', async () => {
		await editor.loadContent(LIST);
		await editor.focusBlockAtPath([0, 0, 0], 1);
		await startCapture(editor);

		const point = await editor.pointForOffset([0, 2, 0], 3);
		await editor.page.mouse.click(point.x, point.y);
		await editor.page.keyboard.insertText(TYPED);
		await editor.waitForRenderFlush();

		const emissions = await stopCapture(editor);
		expect(arrivalVerdict(emissions, [0, 2, 0], 'charlie\n')).toBe(before([0, 2, 0]));
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
		expect(arrivalVerdict(emissions, [1], '$$x^2$$\n')).toBe(before([1]));
	});
});

// A whole-block plugin container holds no character position, so a vertical arrow focuses the
// block itself instead of descending into a column. That landing reaches neither the caret entry
// point nor the editable surface, and it is the one a subscriber keyed on the block at the caret
// reads wrong while the browser catches up.
test.describe('a caret landing on a whole-block plugin container', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		// Seeds a heading, then three mermaid diagrams and a plain code fence.
		await editor.gotoPlugins('mermaid');
	});

	test('is announced at the placement, before any render flush', async () => {
		await editor.focusBlockStart(0);
		await startCapture(editor);

		await editor.page.keyboard.press('ArrowDown');
		const emissions = await stopCapture(editor);

		expect(emissions.filter((e) => namesPath(e, [1]))).toHaveLength(1);
	});

	test('is announced once, not again when the browser reports it', async () => {
		await editor.focusBlockStart(0);
		await startCapture(editor);

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();
		const emissions = await stopCapture(editor);

		expect(emissions.filter((e) => namesPath(e, [1]))).toHaveLength(1);
	});
});
