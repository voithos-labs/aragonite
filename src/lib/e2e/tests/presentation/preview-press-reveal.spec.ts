import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { pointAtRaw } from '../../text-runs';

// A press in a preview mode anchors on the character it was aimed at, and the focused block's
// markers show once the button comes up.
// Requirements: e2e/requirements/presentation/preview-press-reveal.md.

const DOC = 'Before\n\n```js\nconst x = 1;\nfoo();\n```\n\n**bold** some words here\n';
// Raw offsets: the `x` of `const x` in the code block, the `w` of `words` in the paragraph.
const CODE_X = 12;
const PARA_WORDS = 14;

/** Press at raw `offset` of the block at `path`, drag right along the line, release, and read
 *  the selection. The aim point is measured before the press, in the layout the user saw. */
async function dragFrom(editor: EditorPage, path: number[], offset: number) {
	const page = editor.page;
	const start = await pointAtRaw(page, path, offset);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + 20, start.y, { steps: 3 });
	await page.mouse.move(start.x + 40, start.y, { steps: 3 });
	await page.mouse.up();
	await editor.waitForRenderFlush();
	return editor.bridge.getSelectionPaths();
}

for (const mode of ['preview-block', 'preview-inline']) {
	test(`${mode}: a drag from inside an unfocused code block anchors where it was pressed`, async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto(`?presentationMode=${mode}`);
		await editor.loadContent(DOC);
		await editor.focusBlockEnd(0);
		const fence = editor.getBlock(1).locator('.md-fence-line').first();
		await expect(fence).toBeHidden();

		const sel = await dragFrom(editor, [1], CODE_X);

		expect(sel?.anchor).toEqual({ path: [1], offset: CODE_X });
		expect(sel?.focus.offset).toBeGreaterThan(CODE_X);
		await expect(fence).toBeVisible();
	});
}

test('preview-block: a drag from inside an unfocused bold paragraph anchors where it was pressed', async ({
	page
}) => {
	const editor = new EditorPage(page);
	await editor.goto('?presentationMode=preview-block');
	await editor.loadContent(DOC);
	await editor.focusBlockEnd(0);
	const marker = editor.getBlock(2).locator('.md-marker').first();
	await expect(marker).toBeHidden();

	const sel = await dragFrom(editor, [2], PARA_WORDS);

	expect(sel?.anchor).toEqual({ path: [2], offset: PARA_WORDS });
	await expect(marker).toBeVisible();
});
