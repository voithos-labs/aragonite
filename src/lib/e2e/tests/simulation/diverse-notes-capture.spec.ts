import { test } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { runSession } from '../../simulation/user-simulator';
import { FEATURE_TOUR_NOTE } from '../../simulation/notes/feature-tour-note';
import { PROJECT_PLAN_NOTE } from '../../simulation/notes/project-plan-note';
import { OUTLINE_NOTE } from '../../simulation/notes/outline-note';
import { READING_NOTES_NOTE } from '../../simulation/notes/reading-notes-note';
import { MEETING_MINUTES_NOTE } from '../../simulation/notes/meeting-minutes-note';
import { README_NOTE } from '../../simulation/notes/readme-note';

declare const process: { env: Record<string, string | undefined> };

test.skip(!process.env.SIM_CAPTURE, 'set SIM_CAPTURE=1 to run the capture session');

// Longer, more diverse notes than the headline biology note, each putting its distinctive
// construct in the EQUALITY SPINE so end-state equality guards it. Distinct seeds keep the
// injected-typo streams — and the seed-keyed capture directories — independent.
test.describe('note-taking simulation: diverse-notes capture', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('builds the inline-rich feature-tour note', async ({ page }) => {
		await runSession(page, editor, { seed: 11, note: FEATURE_TOUR_NOTE, capture: true });
	});

	test('builds the structurally-deep project-plan note', async ({ page }) => {
		await runSession(page, editor, { seed: 23, note: PROJECT_PLAN_NOTE, capture: true });
	});

	test('builds the three-level outline note', async ({ page }) => {
		await runSession(page, editor, { seed: 31, note: OUTLINE_NOTE, capture: true });
	});

	test('builds the nested-blockquote reading-notes note', async ({ page }) => {
		await runSession(page, editor, { seed: 37, note: READING_NOTES_NOTE, capture: true });
	});

	test('builds the meeting-minutes note', async ({ page }) => {
		await runSession(page, editor, { seed: 41, note: MEETING_MINUTES_NOTE, capture: true });
	});

	test('builds the README note', async ({ page }) => {
		await runSession(page, editor, { seed: 43, note: README_NOTE, capture: true });
	});
});
