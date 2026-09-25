import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { Gestures } from '../../simulation/gestures';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { assertCheckpoint } from '../../simulation/invariants';
import { makeSimContext } from './helpers';

// Footnotes, run in the default gate, covering two parts no long session had reached before:
// the `[^label]: ` definition block, whose Enter-in-the-body split works the way a blockquote's
// does, and the `[^label]` inline reference widget.
//
// The number a reference shows is worked out for display and never modelled here;
// `footnotes-reference.spec.ts` checks the renumbering. This session checks only that the
// structure survives the inserts, edits, splits and undos.

const FOOTNOTE_DOC =
	'Intro paragraph here.\n\n' + // [0]: a new reference is typed here
	'Body cites [^a] mid-sentence.\n\n' + // [1]: a reference already there, to open
	'[^a]: The first note body.\n\n' + // [2]: the definition already there
	'Draft line for a new note.\n'; // [3]: where a new definition forms

test.describe('footnote-ops simulation', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('footnotes');
	});

	test('reference + definition inserts, reveals, edits, split, and undo stay corruption-free', async ({
		page
	}) => {
		const errors = attachErrorCollector(page);
		await errors.start();

		await editor.loadContent(FOOTNOTE_DOC);
		await editor.waitForRenderFlush();
		await expect(page.locator('.footnote-ref')).toHaveCount(1);
		await expect(page.locator('.footnote-def')).toHaveCount(1);

		const ctx = await makeSimContext(page, editor, 'footnote-ops', { errors });
		const g = new Gestures(ctx, makeRng(1));

		await assertCheckpoint(ctx, 'loaded');

		// ── References: type a new one, open it, edit its label, delete it ─────────
		await editor.focusBlockEnd(0);
		await page.keyboard.type(' ');
		await g.typeFootnoteReference('z');
		// Document order is now [^z] (block 0), [^a] (block 1).
		await expect(page.locator('.footnote-ref')).toHaveCount(2);
		await assertCheckpoint(ctx, 'reference-typed');

		// Open the existing [^a] (index 1 in document order) and close it again by clicking
		// block 0: only the view changes, and the bytes must come back identical.
		await g.revealFootnoteReference(1, 0);
		await assertCheckpoint(ctx, 'reference-revealed');

		// Edit [^z]'s label (index 0 in document order) to [^qz] by opening and committing it.
		await g.editFootnoteLabel(0, 'q', 1);
		expect(await editor.bridge.getSource()).toContain('[^qz]');
		await assertCheckpoint(ctx, 'reference-edited');

		// Turn [^qz] (index 0 in document order) into plain text: open it, delete the opening
		// `[`, commit. The reference is gone and its remaining bytes stay.
		await g.deleteFootnoteReference(0, 1);
		await expect(page.locator('.footnote-ref')).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain('^qz]');
		expect(await editor.bridge.getSource()).not.toContain('[^qz]');
		await assertCheckpoint(ctx, 'reference-deleted');

		// ── Definitions: build one, split its body, edit it, leave it ──────────────
		const defIndex = (await editor.bridge.getBlockCount()) - 1;
		await g.typeFootnoteDefinition(defIndex, 'b', 'A second note.');
		expect(await editor.bridge.getBlockKind(defIndex)).toBe('footnote-def');
		await expect(page.locator('.footnote-def')).toHaveCount(2);
		await assertCheckpoint(ctx, 'definition-typed');

		// Enter in the middle of the body splits that child in two: the split must add a child
		// to the container, never to the document root, which the gesture checks itself.
		await g.splitFootnoteDefinitionBody([defIndex, 0]);
		await assertCheckpoint(ctx, 'definition-body-split');

		// Edit the second half of the split; the container rebuilds its raw text around it.
		await g.editContainerBody([defIndex, 1], 'Continued note.');
		expect(await editor.bridge.getSource()).toContain('Continued note.');
		await assertCheckpoint(ctx, 'definition-body-continued');

		// Backspace at the start of the definition's first child lifts it out as the paragraph
		// before the marker, and the rest of the body stays under the marker.
		const beforeExit = await editor.bridge.getSource();
		await g.footnoteDefinitionExitBackspace([defIndex, 0]);
		await assertCheckpoint(ctx, 'definition-exit-backspace');

		// ── Undo back across the definition edits and the deleted reference ─────────
		await g.pause();
		await g.undo();
		expect(await editor.bridge.getSource()).toBe(beforeExit);
		await assertCheckpoint(ctx, 'undo-exit-backspace');

		await g.undo();
		await assertCheckpoint(ctx, 'undo-continuation');

		await g.undo();
		await assertCheckpoint(ctx, 'undo-split');

		await g.undo();
		await assertCheckpoint(ctx, 'undo-definition');
	});
});
