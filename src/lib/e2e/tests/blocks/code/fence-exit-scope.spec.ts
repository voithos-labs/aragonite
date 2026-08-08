import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// The closed-fence Enter-exit lands the new paragraph in the fence's OWN container scope, never
// delegated outside it: a fence last in a blockquote mints its paragraph INSIDE the quote, and a
// second Enter on that empty paragraph breaks out (the shared empty-trailing-line exit).

const quoteChildCount = (editor: EditorPage) =>
	editor.page.evaluate(() => (window as any).__test.getDocument().children[0].children.length);

// Display end of "```\ncode\n```" inside the quote (the offset === length exit).
const CLOSED_DISPLAY_END = 12;
// Body end of "```\ncode\n```" — just before the closer's leading newline; also the
// display end of the unclosed "```\ncode".
const BODY_END = 8;

test.describe('code block — closed-fence Enter-exit lands in-container', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('closed fence as the blockquote last child: Enter mints the paragraph inside the quote', async () => {
		await editor.loadContent('> ```\n> code\n> ```\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('blockquote');

		await editor.focusBlockAtPath([0, 0], CLOSED_DISPLAY_END);
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(3); // quote + fence + minted paragraph

		// The paragraph landed INSIDE the quote: one top-level block holding [fence, paragraph].
		// Pre-fix this delegated upward and appended at root (top-level count 2, quote still one
		// child).
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await quoteChildCount(editor)).toBe(2);
	});

	test('closed-fence escape ladder: Enter lands inside the quote, Enter exits, typed text sits after it', async () => {
		await editor.loadContent('> ```\n> code\n> ```\n');

		await editor.focusBlockAtPath([0, 0], CLOSED_DISPLAY_END);
		await editor.page.keyboard.press('Enter'); // into the quote
		await editor.waitForBlockHostCount(3);
		await editor.page.keyboard.press('Enter'); // out of the quote
		await editor.bridge.waitForBlockCount(2);
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');

		expect(await editor.bridge.getSource()).toBe('> ```\n> code\n> ```\n\nX\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('blockquote');
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
		expect(await editor.parseConverged()).toBe(true);
	});

	test('closed-fence Enter-twice-from-body-end (exitWithEdit) inside a quote lands in-container', async () => {
		await editor.loadContent('> ```\n> code\n> ```\n');

		await editor.focusBlockAtPath([0, 0], BODY_END); // body end, before the closer newline
		await editor.page.keyboard.press('Enter'); // insert a blank line before the closer
		await editor.bridge.waitForSourceContains('> code\n>\n> ```');
		await editor.page.keyboard.press('Enter'); // exitWithEdit: strip the blank, exit downward
		await editor.waitForBlockHostCount(3);

		// The stripped-blank exit minted its paragraph INSIDE the quote, and the fence kept its
		// closer.
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await quoteChildCount(editor)).toBe(2);
		expect(await editor.bridge.getBlockKind(0)).toBe('blockquote');
		expect(await editor.bridge.getSource()).toContain('> ```\n> code\n> ```');
	});

	test('closed fence with a following sibling inside the quote: Enter moves to the sibling, mints nothing', async () => {
		await editor.loadContent('> ```\n> code\n> ```\n>\n> after\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('blockquote');
		const childrenBefore = await quoteChildCount(editor);

		await editor.focusBlockAtPath([0, 0], CLOSED_DISPLAY_END);
		await editor.page.keyboard.press('Enter');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('Zafter');

		// Focus moved to the existing sibling; no block minted, quote child count held.
		expect(await editor.bridge.getSource()).toBe('> ```\n> code\n> ```\n>\n> Zafter\n');
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await quoteChildCount(editor)).toBe(childrenBefore);
	});

	test('closed fence at the document root: Enter appends the paragraph at root (unchanged)', async () => {
		await editor.loadContent('```\ncode\n```\n');

		await editor.focusBlockAtPath([0], CLOSED_DISPLAY_END);
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(2); // fence + appended paragraph
		await editor.typeText('Y');
		await editor.bridge.waitForSourceContains('Y');

		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
		expect(await editor.parseConverged()).toBe(true);
	});

	test('unclosed-fence escape ladder in a quote: auto-close mints inside, next Enter exits', async () => {
		await editor.loadContent('> ```\n> code\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('blockquote');

		await editor.focusBlockAtPath([0, 0], BODY_END);
		await editor.page.keyboard.press('Enter'); // trailing blank line inside the body
		await editor.page.keyboard.press('Enter'); // auto-close: closer + paragraph inside the quote
		await editor.waitForBlockHostCount(3);
		// The auto-closed paragraph is inside the quote, not delegated to root.
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await quoteChildCount(editor)).toBe(2);

		await editor.page.keyboard.press('Enter'); // out of the quote
		await editor.bridge.waitForBlockCount(2);
		await editor.typeText('W');
		await editor.bridge.waitForSourceContains('W');

		const source = await editor.bridge.getSource();
		expect(source).toContain('> ```\n> code\n> ```'); // closer minted, still quoted
		expect(source.indexOf('W')).toBeGreaterThan(source.lastIndexOf('```'));
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
		expect(await editor.parseConverged()).toBe(true);
	});
});
