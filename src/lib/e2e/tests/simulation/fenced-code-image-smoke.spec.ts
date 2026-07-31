import { test } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { runSession } from '../../simulation/user-simulator';
import { BIOLOGY_NOTE } from '../../simulation/notes/biology-note';

// The headline note is the only one that type-builds a fenced code block AND an image, and
// it ran only in the capture-gated suites — so those two kinds went uncovered in CI. Running
// it with `capture:false` arms the cheap oracle half in the default gate; the expensive
// screenshot capture stays gated in diverse-notes-capture.spec.ts.
test.describe('note-taking simulation: fenced-code + image smoke', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('builds the code-and-image biology note and the oracle suite holds', async ({ page }) => {
		await runSession(page, editor, { seed: 2, note: BIOLOGY_NOTE, capture: false });
	});
});
