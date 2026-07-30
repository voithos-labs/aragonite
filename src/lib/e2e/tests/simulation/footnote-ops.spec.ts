import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { Gestures } from '../../simulation/gestures';
import { ExpectationTracker } from '../../simulation/expectation';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import {
	type SimContext,
	assertCoreOracles,
	assertParseConvergence
} from '../../simulation/invariants';

// Ungated footnote-ops oracle for the first-party footnotes plugin. The plugin spans two
// tiers the corruption oracle stack (structured error + `[invariant:…]` watcher, live-CST
// round-trip, nested-state audit, live-vs-reparse convergence) had never seen under a
// state-accumulating watcher: the `[^label]: ` strip-container definition (a not-mergeable
// container in the listItem mold, whose Enter-in-body split rides the shared blockquote
// override — the boundary Task 2's review flagged untested) and the `[^label]` inline
// reference widget (the `[^`-prefix ladder rung, reveal-to-edit). Mirrors math-ops /
// directive-ops: a loaded document on the plugins route (the footnotes plugin is seed-gated,
// so this navigates `?seed=footnotes` and loadContents its own document over the seed's), the
// footnote gesture vocabulary, all oracles re-checked after every move, fixed rng.
//
// The reference NUMBER is derived display state the tracker never models — the reference e2e
// (`footnotes-reference.spec.ts`) is the oracle for the live renumber; this session pins the
// structural integrity the tier's inserts, reveals, edits, splits, and undos must preserve.

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

		const tracker = new ExpectationTracker(await editor.bridge.getSource());
		const ctx: SimContext = { page, editor, tracker, errors, label: 'footnote-ops' };
		const g = new Gestures(ctx, makeRng(1));

		// The core structural oracles run at every checkpoint; convergence (live CST vs a
		// reparse of its serialization) runs alongside them EXCEPT where an Enter-split has
		// left a paragraph pair joined by a single newline — that pair lazily reparses as one
		// paragraph (the documented splitNode divergence, `docs/issues.md`), a platform split
		// defect, not a footnote one, so its waiver is per-checkpoint here exactly as it is
		// across the sim's note fixtures. `math-ops`/`directive-ops` sidestep it by never
		// running convergence after their own splits; this session runs it wherever the tree
		// is not mid-split, so the reference tier and the definition formation stay covered.
		const checkOracles = async (label: string, convergent = true) => {
			await assertCoreOracles(ctx, label);
			if (convergent) await assertParseConvergence(ctx);
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
		// Formed over the blank-line-separated draft paragraph at the tail, not a paragraph
		// split off by Enter — see the gesture's note on the interruptsParagraph divergence.
		const defIndex = (await editor.bridge.getBlockCount()) - 1;
		await g.typeFootnoteDefinition(defIndex, 'b', 'A second note.');
		expect(await editor.bridge.getBlockKind(defIndex)).toBe('footnote-def');
		await expect(page.locator('.footnote-def')).toHaveCount(2);
		await checkOracles('definition-typed');

		// Enter mid-body splits the child into two body children — the split must grow the
		// container's children, never the document root (the Task 2 boundary; the gesture
		// asserts root-stability internally and throws on an escape). Convergence is waived
		// while the split pair is single-newline-joined (see the checkOracles note).
		await g.splitFootnoteDefinitionBody([defIndex, 0]);
		await checkOracles('definition-body-split', false);

		// Edit the split continuation child; the container rebuilds its own raw around it.
		await g.editContainerBody([defIndex, 1], 'Continued note.');
		expect(await editor.bridge.getSource()).toContain('Continued note.');
		await checkOracles('definition-body-continued', false);

		// Backspace at the definition's first body child start delegates upward
		// (not-mergeable) — byte-identical, never an unwrap into loose paragraphs.
		await g.footnoteDefinitionExitBackspace([defIndex, 0]);
		await checkOracles('definition-exit-backspace', false);

		// ── Undo unwind across the definition edits and the reference delete ────────
		await g.pause();
		await g.undo();
		await checkOracles('undo-continuation', false);

		// Undoing the split restores the single-child body, so convergence holds again.
		await g.undo();
		await checkOracles('undo-split');

		await g.undo();
		await checkOracles('undo-definition');
	});
});
