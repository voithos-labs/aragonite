import { test } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { runSession } from '../../simulation/user-simulator';
import { MEETING_MINUTES_NOTE } from '../../simulation/notes/meeting-minutes-note';

// One representative note across many seeds. Each seed orders the typos and detours
// differently, and all of them must leave the bytes as they were and reach the same end state;
// a failure points at one seed. `capture:false` is what keeps this cheap enough to run in the
// default gate, while the capture suites stay behind SIM_CAPTURE.
const SEEDS = [101, 202, 303, 404, 505, 606, 707, 808];

test.describe('note-taking simulation: multi-seed fuzz', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// One seed also undoes and redoes the whole session, one entry at a time; the rest stay
	// light, so the cost goes into covering more seeds rather than more depth.
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
