import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// The paste reattaches the surviving post-caret residue to the last pasted item, so focus must
// land at the end of the pasted content, before that residue rather than at the item's end.
test.describe('cross-block list paste merge: caret at end of pasted content', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('merge with a reattached residue lands the caret before the residue', async () => {
		await editor.loadContent('- alpha\n\nbeta gamma\n');
		await editor.seedClipboard('- x\n- y\n');

		// Cross-block select from the end of the list item into the paragraph below: the delete merges
		// the tail ("gamma") into the item, and the paste reattaches it to the last pasted item ("y").
		await editor.focusBlockAtPath([0, 0, 0], 'alpha'.length);
		await editor.shiftClickBlock([1], 'beta '.length);
		await editor.waitForCrossBlock(true);
		await editor.paste();
		await editor.bridge.waitForSourceMatches(/- ygamma/);

		await editor.page.keyboard.type('Z');
		await editor.bridge.waitForSourceMatches(/- yZgamma/);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/- yZgamma/);
		// The caret never ended up at the item end, past the residue.
		expect(src).not.toMatch(/- ygammaZ/);
	});

	test('single-item merge lands the caret before the residue (singleton path)', async () => {
		await editor.loadContent('- alpha\n\nbeta gamma\n');
		await editor.seedClipboard('- x\n');

		// A single-item clipboard merges the one pasted item into the target leaf, with the residue
		// reattached after it; focus lands at the join, before the residue.
		await editor.focusBlockAtPath([0, 0, 0], 'alpha'.length);
		await editor.shiftClickBlock([1], 'beta '.length);
		await editor.waitForCrossBlock(true);
		await editor.paste();
		await editor.bridge.waitForSourceMatches(/- alphaxgamma/);

		await editor.page.keyboard.type('Z');
		await editor.bridge.waitForSourceMatches(/- alphaxZgamma/);

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/- alphaxZgamma/);
		expect(src).not.toMatch(/- alphaxgammaZ/);
	});
});
