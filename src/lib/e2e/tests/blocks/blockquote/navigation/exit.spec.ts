import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';
import { roundTripStable } from '../../../plugins/helpers';

// The exited source must collapse the empty continuation marker at every nesting depth: ancestor
// quotes must rebuild too, or their stale raw leaks a stranded `> >` / `> > >` line.

/** One level of the exit, waiting on the source it rewrites. */
async function pressEnterUntilSourceChanges(editor: EditorPage): Promise<void> {
	const before = await editor.bridge.getSource();
	await editor.page.keyboard.press('Enter');
	await editor.bridge.waitForSourceWith((s, b) => s !== b, before);
}

test.describe('blockquote navigation — exit on empty trailing line', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('top-level quote exit leaves no stranded empty marker', async () => {
		await editor.loadContent('\n');
		await editor.clickBlock(0);
		await editor.typeText('> first');
		await editor.page.keyboard.press('Enter');
		await editor.typeText('second');
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(4);
		await editor.page.keyboard.press('Enter');
		// No source condition can see this exit: the fixture was typed, so every shape one
		// could name is already present. The second root block is the only sign.
		await editor.bridge.waitForBlockCount(2);

		const source = await editor.bridge.getSource();
		expect(source).toContain('> first');
		expect(source).toContain('> second');
		// A bare `>` between quoted lines is the paragraph separator Enter creates;
		// the stranded marker this guards is one the quote ends on.
		expect(source).not.toMatch(/^>[ \t]*\n(?!>)/m);
		expect(await roundTripStable(editor.page)).toBe(true);
	});

	// Exiting a nested quote has to rebuild the outer quote's raw too, or a `> >` line is left
	// stranded. The exit climbs one level per Enter, the same convention a list outdent uses,
	// so reaching the document takes one press per level.
	test('nested quote (depth 2) exit leaves no stranded "> >" line', async () => {
		await editor.loadContent('> Outer\n> > Inner\n');
		const inner = editor.page.locator('[contenteditable="true"]', { hasText: /^Inner$/ });
		await inner.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(5);
		await pressEnterUntilSourceChanges(editor);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^[^>]/m);

		const source = await editor.bridge.getSource();
		expect(source).toContain('> > Inner');
		expect(source).not.toMatch(/^> >\s*$/m);
		expect(await roundTripStable(editor.page)).toBe(true);
	});

	// Three levels deep tells a full rebuild of every ancestor from a one-level one: rebuilding
	// only the immediate parent strands `> > >` here.
	test('deeply nested quote (depth 3) exit leaves no stranded "> > >" line', async () => {
		await editor.loadContent('> > > Deep\n');
		const deep = editor.page.locator('[contenteditable="true"]', { hasText: /^Deep$/ });
		await deep.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(5);
		await pressEnterUntilSourceChanges(editor);
		await pressEnterUntilSourceChanges(editor);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^[^>]/m);

		const source = await editor.bridge.getSource();
		expect(source).toContain('> > > Deep');
		expect(source).not.toMatch(/^> >(?: >)?\s*$/m);
		expect(await roundTripStable(editor.page)).toBe(true);
	});
});
