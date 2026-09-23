import { test } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { runSession } from '../../simulation/user-simulator';
import { BIOLOGY_NOTE } from '../../simulation/notes/biology-note';

// The main note is the only one that types both a fenced code block and an image, and it ran
// only in the capture suites, so those two kinds went untested in CI. Running it with
// `capture:false` brings the cheap half into the default gate; the expensive screenshots stay
// behind the switch in diverse-notes-capture.spec.ts.
test.describe('note-taking simulation: fenced-code + image smoke', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?slash=on');
	});

	test('builds the code-and-image biology note and the invariant suite holds', async ({ page }) => {
		await runSession(page, editor, { seed: 2, note: BIOLOGY_NOTE, capture: false });
	});
});
