import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

// Enter on a blockquote's empty trailing line exits the quote. The exited
// source must collapse the empty continuation marker at every nesting depth —
// the inner quote rebuilds its own raw, and the ancestor quotes must rebuild too
// or their stale raw leaks a stranded `> >` / `> > >` line.
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
		// The exit is a top-level structural change, not a textual one: the empty
		// paragraph leaves the quote, so the document gains a second root block.
		// A source predicate can't see it — the whole fixture was typed, so every
		// shape it could name is already present before the exiting Enter.
		await editor.bridge.waitForBlockCount(2);

		const source = await editor.bridge.getSource();
		expect(source).toContain('> first');
		expect(source).toContain('> second');
		// A bare `>` BETWEEN quoted lines is the paragraph separator Enter mints;
		// the stranded marker this guards is one the quote ends on.
		expect(source).not.toMatch(/^>[ \t]*\n(?!>)/m);
		expect(await editor.page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	});

	// Regression (note-taking simulation): exiting a NESTED quote rebuilt the
	// inner quote's raw but left the outer quote's raw stale, stranding `> >`.
	test('nested quote (depth 2) exit leaves no stranded "> >" line', async () => {
		await editor.loadContent('> Outer\n> > Inner\n');
		const inner = editor.page.locator('[contenteditable="true"]', { hasText: /^Inner$/ });
		await inner.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(5);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^[^>]/m);

		const source = await editor.bridge.getSource();
		expect(source).toContain('> > Inner');
		expect(source).not.toMatch(/^> >\s*$/m);
		expect(await editor.page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	});

	// Depth-3 discriminates a full ancestor-chain rebuild from a one-level patch:
	// a fix that only rebuilds the immediate parent strands `> > >` here.
	test('deeply nested quote (depth 3) exit leaves no stranded "> > >" line', async () => {
		await editor.loadContent('> > > Deep\n');
		const deep = editor.page.locator('[contenteditable="true"]', { hasText: /^Deep$/ });
		await deep.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(5);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^[^>]/m);

		const source = await editor.bridge.getSource();
		expect(source).toContain('> > > Deep');
		expect(source).not.toMatch(/^> >(?: >)?\s*$/m);
		expect(await editor.page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	});
});
