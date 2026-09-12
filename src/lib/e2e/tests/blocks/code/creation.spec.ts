import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { focusCodeBody } from './conveniences/helpers';

test.describe('code block creation — Enter after typing ```', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter after a typed ``` completes the fence with the caret on its body line', async () => {
		await editor.loadContent('\n');
		await editor.focusBlockStart(0);
		await editor.typeSlowly('```');
		await editor.bridge.waitForSourceContains('```');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');

		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('```\n\n```\n');
		await editor.typeText('body');
		// Regression: swallowed Enter would land "body" on the opener line ("```body").
		await editor.bridge.waitForSourceEquals('```\nbody\n```\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
	});
});

test.describe('code block creation — backtick auto-pair in unclosed fence', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('fourth backtick after ``` does not auto-pair', async () => {
		await editor.loadContent('\n');
		await editor.focusBlockStart(0);
		await editor.typeSlowly('```');
		await editor.bridge.waitForSourceContains('```');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');

		// Auto-pair must not fire while the fence is unclosed (would yield 5 backticks).
		await editor.typeSlowly('`');
		await editor.bridge.waitForSourceContains('````');

		const source = await editor.bridge.getSource();
		const backticks = (source.match(/`/g) ?? []).length;
		expect(backticks).toBe(4);
	});

	// Typing never leaves a fence unclosed past its Enter (the bare opener completes), so the
	// unclosed shape with a body line is LOADED, as a document saved mid-fence is.
	test('backtick on the empty body line of a loaded unclosed fence does not auto-pair', async () => {
		await editor.loadContent('```\n\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
		await editor.focusBlock(0, 4);
		await editor.typeSlowly('`');
		await editor.bridge.waitForSourceMatches(/```\n`/);

		const source = await editor.bridge.getSource();
		const backticks = (source.match(/`/g) ?? []).length;
		expect(backticks).toBe(4);
	});

	test('backtick inside a closed fence still auto-pairs', async () => {
		await editor.loadContent('```\n\n```\n');
		await focusCodeBody(editor);
		await editor.typeSlowly('`');
		await editor.bridge.waitForSourceMatches(/^```\n``\n```/);

		const source = await editor.bridge.getSource();
		const match = source.match(/^```\n([\s\S]*?)\n```\s*$/);
		expect(match, `could not parse body from:\n${source}`).not.toBeNull();
		expect(match![1]).toBe('``');
	});
});
