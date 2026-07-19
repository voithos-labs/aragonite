import { test } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { runSession } from '../../simulation/user-simulator';
import { BIOLOGY_NOTE } from '../../simulation/notes/biology-note';

declare const process: { env: Record<string, string | undefined> };

test.skip(!process.env.SIM_CAPTURE, 'set SIM_CAPTURE=1 to run the capture session');

test.describe('note-taking simulation: long-session capture', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// The full note exercises every HOLD construct and exits three lists; the
	// always-on oracles (nested-state consistency, round-trip, no-errors,
	// undo/redo differential) must all hold across the whole session.
	test('builds the full biology note and records a checkpoint manifest', async ({ page }) => {
		await runSession(page, editor, { seed: 7, note: BIOLOGY_NOTE, capture: true });
	});
});
