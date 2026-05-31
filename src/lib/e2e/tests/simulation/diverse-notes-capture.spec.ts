import { test } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { runSession } from '../../simulation/user-simulator';
import { FEATURE_TOUR_NOTE } from '../../simulation/notes/feature-tour-note';
import { PROJECT_PLAN_NOTE } from '../../simulation/notes/project-plan-note';

test.skip(!process.env.SIM_CAPTURE, 'set SIM_CAPTURE=1 to run the capture session');

// Two longer, more diverse notes than the headline biology note, run through the
// same oracle suite to surface bugs over constructs the biology note skipped:
// dense inline variety (feature tour) and deep container nesting (project plan).
// Distinct seeds keep the injected-typo streams independent across the notes.
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
});
