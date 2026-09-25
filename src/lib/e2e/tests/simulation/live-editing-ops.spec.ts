import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { Gestures } from '../../simulation/gestures';
import { makeRng } from '../../simulation/rng';
import { assertCheckpoint } from '../../simulation/invariants';
import { makeSimContext } from './helpers';

// Every live-editing gesture, run once over a document shaped to reach it, so coverage never
// depends on which seed drew what. The seeded sessions run the same gestures woven into a note
// (biology-note); this spec is what turns a missing one into a failure rather than a gap.
// What each gesture is expected to do: requirements/simulation/live-editing-ops.md.

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
		await assertCheckpoint(ctx, 'after-live-flip');

		for (const format of ['strong', 'strikethrough', 'inlineCode'] as const) {
			await g.liveToggleFormat(PROSE, 'prose', format);
			await assertCheckpoint(ctx, `after-toggle-${format}`);
		}

		await g.liveEdgeBackspace(PROSE, 'cell division');
		await assertCheckpoint(ctx, 'after-edge-backspace');

		await g.liveDemoteHeading(HEADING);
		await assertCheckpoint(ctx, 'after-demote');

		await g.liveSplitInsideConstruct(PROSE, 'cell division');
		await assertCheckpoint(ctx, 'after-split');

		await g.liveLinkCardEdit('syllabus', 'https://bio.example/next');
		await assertCheckpoint(ctx, 'after-card-commit');

		// Every gesture here is built to leave the bytes as they were, so the document ends as
		// it started, which is the one check they are all answerable to.
		expect(await editor.bridge.getSource()).toBe(canonical);
	});

	// Typing an opener is the one live rule that creates a block's markers rather than editing
	// behind them, so the expected answer is what checks it here: every byte after the new block
	// is predicted keystroke by keystroke, and creating it is the only resync allowed.
	test('a typed block opener creates its chrome and predicts the content behind it', async ({
		page
	}) => {
		await editor.loadContent(DOC);
		await editor.waitForRenderFlush();
		const canonical = await editor.bridge.getSource();

		const ctx = await makeSimContext(page, editor, 'live-typed-openers');
		const g = new Gestures(ctx, makeRng(11));

		await g.liveTypeHeadingOpener(PROSE, 'Recap');
		await assertCheckpoint(ctx, 'after-heading-opener');

		await g.liveTypeFenceOpener(PROSE, 'js');
		await assertCheckpoint(ctx, 'after-fence-opener');

		await g.liveTypeTableOpener(PROSE, ['phase', 'result']);
		await assertCheckpoint(ctx, 'after-table-opener');

		expect(await editor.bridge.getSource()).toBe(canonical);
	});
});
