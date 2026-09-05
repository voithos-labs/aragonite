import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { PluginsPage } from './helpers';

// Enter at the end of a lone `$$` completes the fence pair the adjacent-line grammar could never be
// typed into — the plugin-surface twin of the built-in table registrant. The source bytes are the
// oracle, and where the caret landed is read by typing into it rather than by asking for it.
// Requirements: e2e/requirements/plugins/latex-typed-formation.md.

const COMPLETED = '$$\n\n$$\n';

/** Type `text` at the end of block `index` and press Enter there. */
async function typeAndEnter(editor: EditorPage, index: number, text: string): Promise<void> {
	await editor.clickBlock(index);
	await editor.page.keyboard.press('End');
	await editor.waitForRenderFlush();
	await editor.typeSlowly(text);
	await editor.bridge.waitForSourceContains(text);
	await editor.waitForRenderFlush();
	await editor.page.keyboard.press('Enter');
}

test.describe('block math: typed formation', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('mathblock');
		await editor.loadContent('\n');
	});

	test('a lone $$ plus Enter becomes one math block around an empty body', async () => {
		await typeAndEnter(editor, 0, '$$');

		await editor.bridge.waitForSourceEquals(COMPLETED);
		expect(await editor.bridge.getBlockKind(0)).toBe('mathBlock');
		expect(await editor.bridge.getBlockCount()).toBe(1);
	});

	// A revealed source commits on blur, so the block above is both the blur target and the proof
	// that the completion replaced only its own slot.
	test('the caret lands on the body line, so the typed expression lands there', async ({
		page
	}) => {
		await editor.loadContent('Before\n\n\n');
		await typeAndEnter(editor, 1, '$$');
		await editor.bridge.waitForSourceContains(COMPLETED);

		await page.keyboard.type('x^2');
		await editor.getBlock(0).click();

		await editor.bridge.waitForSourceContains('$$\nx^2\n$$\n');
	});

	// A render-primary leaf commits on blur, so the reveal→blur cycle is the unit an undo follows.
	// Undoing from INSIDE the still-focused reveal is inert today (#161), so the blur is the
	// gesture under test, not a workaround the caret assertions could skip.
	test('one undo after the blur restores the paragraph byte-for-byte', async ({ page }) => {
		await editor.loadContent('Before\n\n\n');
		await typeAndEnter(editor, 1, '$$');
		await editor.bridge.waitForSourceContains(COMPLETED);
		await editor.getBlock(0).click();
		await editor.waitForRenderFlush();

		await editor.undo();
		await editor.bridge.waitForSourceEquals('Before\n\n$$\n');
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');

		// The undo snapshot anchors where the caret WAS, not where the mint sent it.
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceEquals('Before\n\n$$Z\n');
	});

	// An opener line carrying body text implies no multi-line form, so it leaves the shape any
	// tail-block split leaves rather than a shape of its own.
	test('an opener carrying body text falls through to the ordinary split', async () => {
		await typeAndEnter(editor, 0, '$$ x');

		await editor.bridge.waitForBlockCount(2);
		await editor.bridge.waitForSourceEquals('$$ x\n\n\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
	});

	test('live mode mints the same block and lands the expression in its body', async ({ page }) => {
		await editor.loadContent('Before\n\n\n');
		await editor.setPresentationMode('live');
		await editor.waitForRenderFlush();
		await typeAndEnter(editor, 1, '$$');
		await editor.bridge.waitForSourceContains(COMPLETED);

		await page.keyboard.type('x^2');
		await editor.getBlock(0).click();

		await editor.bridge.waitForSourceContains('$$\nx^2\n$$\n');
	});

	// A decline is only worth asserting if the same press works once the mode lifts — otherwise a
	// key that never reached the editor would pass it. The completion afterwards is that proof.
	test('reading mode declines the completion until the mode lifts', async ({ page }) => {
		await editor.loadContent('$$\n');
		await editor.setPresentationMode('reading');
		await editor.waitForRenderFlush();
		await editor.clickBlock(0);
		await page.keyboard.press('Enter');
		await editor.waitForRenderFlush();

		expect(await editor.bridge.getSource()).toBe('$$\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');

		await editor.setPresentationMode('source');
		await editor.waitForRenderFlush();
		await editor.clickBlock(0);
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals(COMPLETED);
	});
});

// Recognition is gated on installation, and so is completion: the editor harness loads no plugins,
// so the same keystrokes must leave bare GFM's own shape.
test.describe('block math: typed formation without the plugin', () => {
	test('$$ plus Enter splits like any other paragraph', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('\n');

		await typeAndEnter(editor, 0, '$$');

		await editor.bridge.waitForBlockCount(2);
		await editor.bridge.waitForSourceEquals('$$\n\n\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
	});
});
