import { test } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// A reference link reads as a link only with the document's definitions, so every edit that
// checks its bytes by reparsing them has to read with those definitions too.

const DEFINITION = '\n\n[ref]: https://x.com\n';

// Each row selects by Shift+ArrowRight from `offset`, presses Mod+B, then types a marker at the
// line end: the marker lands only after the chord was handled, so an unchanged line is a
// refusal and not a chord still in flight.
const TOGGLES = [
	{ form: 'a reference link', line: 'see [text][ref] here', offset: 7, extend: 13 },
	{ form: 'a reference link', line: 'see [text][ref] here', offset: 1, extend: 6 },
	{ form: 'an inline link', line: 'see [text](https://x.com) here', offset: 7, extend: 23 },
	{ form: 'an inline link', line: 'see [text](https://x.com) here', offset: 1, extend: 6 }
];

test.describe('inline editing, delimiters beside a reference link', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const { form, line, offset, extend } of TOGGLES) {
		test(`Mod+B over ${extend} bytes from ${offset} across the edge of ${form} writes nothing`, async () => {
			await editor.loadContent(line + DEFINITION);
			await editor.focusBlock(0, offset);
			for (let i = 0; i < extend; i++) await editor.page.keyboard.press('Shift+ArrowRight');
			await editor.page.keyboard.press('ControlOrMeta+b');
			await editor.page.keyboard.press('End');
			await editor.page.keyboard.type('Z');

			await editor.bridge.waitForSourceEquals(`${line}Z${DEFINITION}`);
		});
	}

	test('Mod+B over a whole reference link wraps it', async () => {
		await editor.loadContent('see [text][ref] here' + DEFINITION);
		await editor.focusBlock(0, 4);
		for (let i = 0; i < 11; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('ControlOrMeta+b');

		await editor.bridge.waitForSourceEquals('see **[text][ref]** here' + DEFINITION);
	});

	// Without the definition `*[a*` is emphasis and the typed `*` would step over its closer.
	test('a * typed before a * inside a reference link is written', async () => {
		await editor.loadContent('*[a*][ref]' + DEFINITION);
		await editor.focusBlock(0, 3);
		await editor.page.keyboard.type('*Z');

		await editor.bridge.waitForSourceEquals('*[a*Z*][ref]' + DEFINITION);
	});
});
