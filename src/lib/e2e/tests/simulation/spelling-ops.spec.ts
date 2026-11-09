import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { Gestures } from '../../simulation/gestures';
import { makeRng } from '../../simulation/rng';
import { assertCheckpoint } from '../../simulation/invariants';
import { makeSimContext } from './helpers';

// A spelling pick and its undo, with the reference checks after each. Parked with the package's
// own rows: the pick needs the editor to read blocks and paint.

const DOC = 'Alpha has a tset in it.\n\nBeta stays as it is.\n';

test.describe('spelling-ops simulation', () => {
	test.skip(true, 'parked until the editor reads blocks (`Editor.blockAt`) and paints');

	test('a picked suggestion rewrites one word, and one Ctrl+Z gives the bytes back', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto('?spell=on');
		await editor.loadContent(DOC);
		await expect(page.locator('.spell-overlay')).toHaveCount(1);
		const ctx = await makeSimContext(page, editor, 'spelling-ops');
		const g = new Gestures(ctx, makeRng(1));
		await assertCheckpoint(ctx, 'loaded');

		const written = await g.pickSpelling('tset');
		expect(await editor.bridge.getSource()).toBe(DOC.replace('tset', written));
		await assertCheckpoint(ctx, 'picked');

		await g.undo();
		await editor.bridge.waitForSourceEquals(DOC);
		await assertCheckpoint(ctx, 'undone');
	});
});
