import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

const TEXT_NODE = 3;

// The page object's caret helpers set up almost every spec, so the caret they leave must be one
// the editor itself places: in a text node, at a raw offset the editor reports back.

/** The DOM caret's anchor node type and offset, and the editor's own reading of it. */
async function readCaret(editor: EditorPage) {
	const dom = await editor.page.evaluate(() => {
		const selection = window.getSelection()!;
		return { nodeType: selection.anchorNode?.nodeType, offset: selection.anchorOffset };
	});
	return { dom, editor: (await editor.bridge.getSelectionPaths())?.focus };
}

test.describe('the page object caret helpers', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('focusBlockEnd lands in the last text node at the content end', async () => {
		await editor.loadContent('a **bold** b\n');
		await editor.focusBlockEnd(0);

		const caret = await readCaret(editor);
		expect(caret.dom).toEqual({ nodeType: TEXT_NODE, offset: 2 });
		expect(caret.editor).toEqual({ path: [0], offset: 12 });
	});

	test('focusBlockStart lands in the first text node at offset 0', async () => {
		await editor.loadContent('Hello world\n');
		await editor.focusBlockStart(0);

		const caret = await readCaret(editor);
		expect(caret.dom).toEqual({ nodeType: TEXT_NODE, offset: 0 });
		expect(caret.editor).toEqual({ path: [0], offset: 0 });
	});

	test('focusBlock takes a raw offset and lands on a text node', async () => {
		await editor.loadContent('a **bold** b\n');
		await editor.focusBlock(0, 5);

		const caret = await readCaret(editor);
		expect(caret.dom.nodeType).toBe(TEXT_NODE);
		expect(caret.editor).toEqual({ path: [0], offset: 5 });
	});

	test('a container block places the caret in its first or last leaf', async () => {
		await editor.loadContent('- alpha\n- beta\n');
		await editor.focusBlockStart(0);
		expect((await readCaret(editor)).editor).toEqual({ path: [0, 0, 0], offset: 0 });

		await editor.focusBlockEnd(0);
		expect((await readCaret(editor)).editor).toEqual({ path: [0, 1, 0], offset: 4 });
	});

	test('a table places the caret in its first or last cell', async () => {
		await editor.loadContent('| a | b |\n| --- | --- |\n| c | dd |\n');
		await editor.focusBlockStart(0);
		expect((await readCaret(editor)).editor).toEqual({ path: [0, 0, 0], offset: 0 });

		await editor.focusBlockEnd(0);
		expect((await readCaret(editor)).editor).toEqual({ path: [0, 1, 1], offset: 2 });
	});
});
