import { test } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { runSession } from '../../simulation/user-simulator';
import { MEETING_MINUTES_NOTE } from '../../simulation/notes/meeting-minutes-note';

// One representative mid-weight note across many seeds. The seed drives the typo
// stream and which cancelling detours fire, so each seed is a distinct interleaving
// of typos, the jump-back correction, the select-delete-undo and copy-paste-undo
// detours, and the undo/redo differential — all of which must NET TO IDENTITY and
// leave the same canonical end state. Failures isolate per seed and Playwright runs
// them in parallel. `capture:false` keeps this fast: oracles only, no screenshots —
// which is why this fuzz runs ungated in the default simulation project while the
// capture suites stay behind SIM_CAPTURE.
const SEEDS = [101, 202, 303, 404, 505, 606, 707, 808];

test.describe('note-taking simulation: multi-seed fuzz', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// One seed also runs the whole-session undo-unwind oracle (one undo/redo per stack
	// entry); the rest stay lean so the fuzz breadth carries the cost, not the depth.
	const UNDO_UNWIND_SEED = SEEDS[0];

	for (const seed of SEEDS) {
		test(`seed ${seed} reaches the canonical end state`, async ({ page }) => {
			await runSession(page, editor, {
				seed,
				note: MEETING_MINUTES_NOTE,
				capture: false,
				undoUnwind: seed === UNDO_UNWIND_SEED
			});
		});
	}
});
