import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { Gestures } from '../../simulation/gestures';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { assertCoreOracles, assertParseConvergence } from '../../simulation/invariants';
import { makeSimContext } from './helpers';

// Ungated footnote-ops oracle, spanning two tiers the oracle stack had never seen under a
// state-accumulating watcher: the `[^label]: ` strip-container definition (whose Enter-in-body
// split rides the shared blockquote override) and the `[^label]` inline reference widget.
//
// The reference NUMBER is derived display state the tracker never models —
// `footnotes-reference.spec.ts` is the oracle for the live renumber; this session pins only
// the structural integrity the tier's inserts, reveals, edits, splits and undos preserve.

const FOOTNOTE_DOC =
	'Intro paragraph here.\n\n' + // [0] — a fresh reference is typed here
	'Body cites [^a] mid-sentence.\n\n' + // [1] — a seeded reference to reveal
	'[^a]: The first note body.\n\n' + // [2] — the seeded definition
	'Draft line for a new note.\n'; // [3] — a blank-line-separated slot a new definition forms in

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

		const checkOracles = async (label: string) => {
			await assertCoreOracles(ctx, label);
			await assertParseConvergence(ctx);
		};
		await checkOracles('loaded');

		// ── Reference tier: type a fresh reference, reveal, edit its label, delete ──
		await editor.focusBlockEnd(0);
		await page.keyboard.type(' ');
		await g.typeFootnoteReference('z');
		// Document order is now [^z] (block 0), [^a] (block 1).
		await expect(page.locator('.footnote-ref')).toHaveCount(2);
		await checkOracles('reference-typed');

		// Reveal the seeded [^a] (doc-order index 1) and fold it back onto block 0 — a
		// pure view toggle, byte-identical across the round trip.
		await g.revealFootnoteReference(1, 0);
		await checkOracles('reference-revealed');

		// Edit [^z]'s label (doc-order index 0) to [^qz] through the reveal→commit cycle.
		await g.editFootnoteLabel(0, 'q', 1);
		expect(await editor.bridge.getSource()).toContain('[^qz]');
		await checkOracles('reference-edited');

		// Degrade [^qz] (doc-order index 0) to literal text: reveal, delete the opening `[`,
		// commit. The reference is gone; its remaining bytes stay.
		await g.deleteFootnoteReference(0, 1);
		await expect(page.locator('.footnote-ref')).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain('^qz]');
		expect(await editor.bridge.getSource()).not.toContain('[^qz]');
		await checkOracles('reference-deleted');

		// ── Definition tier: form one from scratch, split its body, edit, exit ──────
		const defIndex = (await editor.bridge.getBlockCount()) - 1;
		await g.typeFootnoteDefinition(defIndex, 'b', 'A second note.');
		expect(await editor.bridge.getBlockKind(defIndex)).toBe('footnote-def');
		await expect(page.locator('.footnote-def')).toHaveCount(2);
		await checkOracles('definition-typed');

		// Enter mid-body splits the child into two body children — the split must grow the
		// container's children, never the document root (the Task 2 boundary; the gesture
		// asserts root-stability internally and throws on an escape).
		await g.splitFootnoteDefinitionBody([defIndex, 0]);
		await checkOracles('definition-body-split');

		// Edit the split continuation child; the container rebuilds its own raw around it.
		await g.editContainerBody([defIndex, 1], 'Continued note.');
		expect(await editor.bridge.getSource()).toContain('Continued note.');
		await checkOracles('definition-body-continued');

		// Backspace at the definition's first body child start delegates upward
		// (not-mergeable) — byte-identical, never an unwrap into loose paragraphs.
		await g.footnoteDefinitionExitBackspace([defIndex, 0]);
		await checkOracles('definition-exit-backspace');

		// ── Undo unwind across the definition edits and the reference delete ────────
		await g.pause();
		await g.undo();
		await checkOracles('undo-continuation');

		await g.undo();
		await checkOracles('undo-split');

		await g.undo();
		await checkOracles('undo-definition');
	});
});
