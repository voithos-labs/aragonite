import { test } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { runSession } from '../../simulation/user-simulator';
import { MEETING_MINUTES_NOTE } from '../../simulation/notes/meeting-minutes-note';
import { MULTI_SEEDS } from '../../simulation/multi-seeds';

// One representative note across the seeds that together draw every detour (`multi-seeds.ts`).
// Each must leave the bytes as they were and reach the same end state; a failure points at one
// seed. `capture:false` keeps this cheap enough for the default gate.

test.describe('note-taking simulation: multi-seed fuzz', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// One seed also undoes and redoes the whole session, one entry at a time; the rest stay
	// light, so the cost goes into covering more seeds rather than more depth.
	const UNDO_UNWIND_SEED = MULTI_SEEDS[0];

	for (const seed of MULTI_SEEDS) {
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
