import { test } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { runSession } from '../../simulation/user-simulator';
import { MEETING_MINUTES_NOTE } from '../../simulation/notes/meeting-minutes-note';

// One representative note across many seeds. Each seed is a distinct INTERLEAVING of typos
// and cancelling detours, all of which must net to identity and leave the same canonical end
// state; failures isolate per seed. `capture:false` is what keeps this fuzz cheap enough to
// run ungated while the capture suites stay behind SIM_CAPTURE.
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
