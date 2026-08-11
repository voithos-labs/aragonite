import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { Gestures } from '../../simulation/gestures';
import { makeRng } from '../../simulation/rng';
import { assertCoreOracles } from '../../simulation/invariants';
import { makeSimContext } from './helpers';

// Deterministic reachability for the live-editing gesture family: every gesture fires once
// over a document shaped to reach it, so coverage never depends on which seed drew what. The
// seeded sessions fire the same gestures woven into a note (biology-note) — this spec is what
// makes each one's absence a failure rather than a gap.
// Per-gesture predictions: requirements/simulation/live-editing-ops.md.

const DOC = [
	'# Live rules',
	'',
	'These notes pair **cell division** with plain prose and a [syllabus](https://bio.example/s).',
	''
].join('\n');

const HEADING = 0;
const PROSE = 1;

test.describe('note-taking simulation: live-mode editing ops', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('every live-only rule holds, costs one undo, and leaves the bytes as it found them', async ({
		page
	}) => {
		await editor.loadContent(DOC);
		await editor.waitForRenderFlush();
		const canonical = await editor.bridge.getSource();

		const ctx = await makeSimContext(page, editor, 'live-editing-ops');
		const g = new Gestures(ctx, makeRng(5));

		await g.flipPresentationMode('live');
		await assertCoreOracles(ctx, 'after-live-flip');

		for (const format of ['strong', 'strikethrough', 'inlineCode'] as const) {
			await g.liveToggleFormat(PROSE, 'prose', format);
			await assertCoreOracles(ctx, `after-toggle-${format}`);
		}

		await g.liveEdgeBackspace(PROSE, 'cell division');
		await assertCoreOracles(ctx, 'after-edge-backspace');

		await g.liveDemoteHeading(HEADING);
		await assertCoreOracles(ctx, 'after-demote');

		await g.liveSplitInsideConstruct(PROSE, 'cell division');
		await assertCoreOracles(ctx, 'after-split');

		await g.liveLinkCardEdit('syllabus', 'https://bio.example/next');
		await assertCoreOracles(ctx, 'after-card-commit');

		// The family is net-identity by construction, so the document it started from is the
		// document it ends on — the one assertion every gesture above is accountable to.
		expect(await editor.bridge.getSource()).toBe(canonical);
	});

	// The opener class is the one live rule that MINTS chrome rather than editing behind it, so
	// the tracker is the oracle here: every byte behind the mint is predicted keystroke by
	// keystroke, and the mint itself is the only resync the gesture is allowed.
	test('a typed block opener mints its chrome and predicts the content behind it', async ({
		page
	}) => {
		await editor.loadContent(DOC);
		await editor.waitForRenderFlush();
		const canonical = await editor.bridge.getSource();

		const ctx = await makeSimContext(page, editor, 'live-typed-openers');
		const g = new Gestures(ctx, makeRng(11));

		await g.liveTypeHeadingOpener(PROSE, 'Recap');
		await assertCoreOracles(ctx, 'after-heading-opener');

		await g.liveTypeFenceOpener(PROSE, 'js');
		await assertCoreOracles(ctx, 'after-fence-opener');

		expect(await editor.bridge.getSource()).toBe(canonical);
	});
});
