import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// A list whose ordered flag matches no ancestor must SPLIT the enclosing list at the caret
// and splice between the halves — nesting it inside the target item leaves the trailing
// slice at item-continuation indent.
test.describe('paste: mismatched-type list into list item breaks out', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ordered list pasted into the middle of an unordered item splits the list', async () => {
		await editor.loadContent('- Unordered three\n');
		await editor.seedClipboard('1. Ordered first\n2. Ordered second\n3. Ordered third\n');

		await editor.focusBlockAtPath([0, 0, 0], 9);
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceMatches(/^- three$/m);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^- Unordered$/m);
		expect(src).toMatch(/^1\. Ordered first$/m);
		expect(src).toMatch(/^2\. Ordered second$/m);
		expect(src).toMatch(/^3\. Ordered third$/m);
		expect(src).toMatch(/^- three$/m);
		// Buggy state placed the pasted ordered list at the 2-space item-indent.
		expect(src).not.toMatch(/^ {2,}1\. Ordered first$/m);
		// Buggy state also placed "three" at the 3-space continuation indent.
		expect(src).not.toMatch(/^ {2,}three$/m);
	});

	test('ordered list pasted at the end of an unordered item places paste after it', async () => {
		await editor.loadContent('- Unordered\n');
		await editor.seedClipboard('1. a\n2. b\n');

		await editor.focusBlockAtPath([0, 0, 0], 'Unordered'.length);
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceMatches(/^2\. b$/m);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^- Unordered$/m);
		expect(src).toMatch(/^1\. a$/m);
		expect(src).toMatch(/^2\. b$/m);
		// No indentation on the pasted ordered list.
		expect(src).not.toMatch(/^ {2,}1\. a$/m);
	});

	test('ordered list pasted at the start of an unordered item places paste before it', async () => {
		await editor.loadContent('- Unordered\n');
		await editor.seedClipboard('1. a\n2. b\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceMatches(/^2\. b$/m);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^1\. a$/m);
		expect(src).toMatch(/^2\. b$/m);
		expect(src).toMatch(/^- Unordered$/m);
		// Pasted ordered list must precede the unordered list.
		expect(src.indexOf('1. a')).toBeLessThan(src.indexOf('- Unordered'));
	});

	// Regression: clipboards without a trailing newline otherwise leave the
	// last pasted item un-terminated, concatenating with the next block on
	// serialization ("3. Ordered" + "- third" → "3. Ordered- third").
	test('ordered list without trailing newline pastes cleanly into unordered item', async () => {
		await editor.loadContent('- Unordered first\n- Unordered second\n- Unordered third\n');
		await editor.seedClipboard('1. first\n2. Ordered second\n3. Ordered');

		await editor.focusBlockAtPath([0, 2, 0], 'Unordered'.length);
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceMatches(/^- third$/m);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^3\. Ordered$/m);
		expect(src).toMatch(/^- third$/m);
		expect(src).not.toMatch(/^3\. Ordered-/m);
	});

	test('caret lands at the end of the pasted content, not the trailing residue', async () => {
		await editor.loadContent('- Unordered three\n');
		await editor.seedClipboard('1. Ordered first\n2. Ordered second\n3. Ordered third\n');

		// Break out in the MIDDLE of the item, so the residue "three" becomes the
		// trailing second-half list. The caret must land at the end of the last
		// PASTED item, never on the residue.
		await editor.focusBlockAtPath([0, 0, 0], 9);
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceMatches(/^- three$/m);

		await editor.page.keyboard.type('X');
		await editor.bridge.waitForSourceMatches(/^3\. Ordered thirdX$/m);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^3\. Ordered thirdX$/m);
		// The residue item is untouched — the caret never parked there.
		expect(src).toMatch(/^- three$/m);
		expect(src).not.toMatch(/threeX/);
	});

	test('unordered list pasted into ordered list item also breaks out (symmetry)', async () => {
		await editor.loadContent('1. First target\n');
		await editor.seedClipboard('- paste one\n- paste two\n');

		await editor.focusBlockAtPath([0, 0, 0], 'First'.length);
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceMatches(/^2\. target$/m);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^1\. First$/m);
		expect(src).toMatch(/^- paste one$/m);
		expect(src).toMatch(/^- paste two$/m);
		// Continuous numbering across the paste gap: split slot burns one number,
		// second half starts at 2. Matches the exit-paragraph convention.
		expect(src).toMatch(/^2\. target$/m);
		// Buggy nesting would indent the unordered list.
		expect(src).not.toMatch(/^ {2,}- paste one$/m);
	});
});
