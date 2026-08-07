import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// The old guard compared a container-local index against the ROOT child count, so a nested code
// block either appended a spurious paragraph (false guard) or no-op'd past a real next sibling
// (true guard).

// Raw offset of the closer boundary for the body "code\n" (== bodyEnd). Shared by every code block
// here: the offset is local to the block's own contenteditable, and a quote's `> ` is ambient.
const CLOSER_BOUNDARY = 8;

async function pressDeleteAtCloser(editor: EditorPage, path: number[]) {
	await editor.focusBlockAtPath(path, CLOSER_BOUNDARY);
	await editor.page.keyboard.press('Delete');
}

test.describe('code block — forward-Delete at closer exit', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('root code block followed by a paragraph: focus moves to the paragraph', async () => {
		await editor.loadContent('```\ncode\n```\n\nafter\n');
		const blockCountBefore = await editor.bridge.getBlockCount();

		await pressDeleteAtCloser(editor, [0]);
		await editor.waitForRenderFlush();

		// Caret landed in the paragraph; typing proves real focus, not a no-op.
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('Xafter');
		expect(await editor.bridge.getSource()).toBe('```\ncode\n```\n\nXafter\n');
		expect(await editor.bridge.getBlockCount()).toBe(blockCountBefore);
	});

	// The root single-block no-op is already covered by editing-block-exit.spec.ts; only the
	// cross-boundary arrangements the old root-count guard mishandled need coverage here.

	test('nested code block, paragraph follows at root: the gap traps the exit, then it delegates', async () => {
		await editor.loadContent('> ```\n> code\n> ```\n\nafter\n');
		// Self-validate the fixture: blockquote[codeBlock] at root 0, paragraph at root 1.
		expect(await editor.bridge.getBlockKind(0)).toBe('blockquote');
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
		const blockCountBefore = await editor.bridge.getBlockCount();

		// The fence ends the blockquote, so the exit meets the container's own scope-end
		// gap first (requirements/selection/gap-caret-arrival.md); the next Delete leaves.
		await pressDeleteAtCloser(editor, [0, 0]);
		await editor.bridge.waitForGapCaret({ parentPath: [0], index: 1 });
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForGapCaret(null);

		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('Xafter');
		expect(await editor.bridge.getSource()).toBe('> ```\n> code\n> ```\n\nXafter\n');
		expect(await editor.bridge.getBlockCount()).toBe(blockCountBefore);
	});

	test('nested code block at the true document end: Delete appends nothing', async () => {
		await editor.loadContent('para\n\n> ```\n> code\n> ```\n');
		// paragraph at root 0, blockquote[codeBlock] last at root 1 — the code block
		// sits at the true document end, reachable only by upward delegation.
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
		expect(await editor.bridge.getBlockKind(1)).toBe('blockquote');

		await pressDeleteAtCloser(editor, [1, 0]);
		// The caret parks in the blockquote's scope-end gap; the document is untouched,
		// which is what the container-local-index regression is about.
		await editor.bridge.waitForGapCaret({ parentPath: [1], index: 1 });
		await editor.waitForNoSourceMutation();

		expect(await editor.bridge.getSource()).toBe('para\n\n> ```\n> code\n> ```\n');
		expect(await editor.bridge.getBlockCount()).toBe(2);
	});

	test('nested code block with a sibling paragraph inside the blockquote: focus moves to the sibling', async () => {
		await editor.loadContent('> ```\n> code\n> ```\n>\n> sibling\n');
		// blockquote[codeBlock, paragraph] — the next block is the sibling INSIDE
		// the container, not a delegation target.
		expect(await editor.bridge.getBlockKind(0)).toBe('blockquote');
		const blockCountBefore = await editor.bridge.getBlockCount();

		await pressDeleteAtCloser(editor, [0, 0]);
		await editor.waitForRenderFlush();

		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('Xsibling');
		expect(await editor.bridge.getSource()).toBe('> ```\n> code\n> ```\n>\n> Xsibling\n');
		expect(await editor.bridge.getBlockCount()).toBe(blockCountBefore);
	});
});
