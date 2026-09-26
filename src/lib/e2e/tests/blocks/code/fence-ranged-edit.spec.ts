import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { attachIme } from '../../../simulation/ime';

// Where the mode hides a code block's fence lines (live mode here), every gesture over a range
// applies only to the part of the selection inside the body, so neither hidden fence line can be
// rewritten into an unclosed fence that absorbs the document. Requirements: `fence-ranged-edit.md`.

// Fixture display text "```js\nconst x = 1\n```":
// opener text [0,5) · body [6,17) · closer text [18,21).
const SOURCE = '```js\nconst x = 1\n```\n';
const BODY_MID = 12; // inside "const x = 1", before "x"
const PAST_BODY = 8; // Shift+ArrowRight presses that run past the body's end

async function selectFrom(editor: EditorPage, start: number, presses: number) {
	await editor.focusBlock(0, start);
	for (let i = 0; i < presses; i++) await editor.page.keyboard.press('Shift+ArrowRight');
}

test.describe('code block: ranged edits reaching a hidden fence line', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.setPresentationMode('live');
		await editor.loadContent(SOURCE);
		await editor.getBlock(0).click();
	});

	test('undo restores the whole block after a clamped delete', async () => {
		await selectFrom(editor, BODY_MID, PAST_BODY);
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('const \n');

		await editor.undo();
		await editor.bridge.waitForSourceContains('const x = 1');
		expect(await editor.bridge.getSource()).toBe(SOURCE);
	});

	test('paste over a selection past the body replaces only the body part', async () => {
		await editor.seedClipboard('Y');
		await selectFrom(editor, BODY_MID, PAST_BODY);
		await editor.paste();
		await editor.bridge.waitForSourceContains('const Y');

		expect(await editor.bridge.getSource()).toBe('```js\nconst Y\n```\n');
	});

	// The range opens on the highlighted `const` at the body start [6] and ends inside `foo` [20],
	// across the line break.
	for (const [gesture, select] of [
		['a drag', () => editor.dragFromTo([0], 6, [0], 20)],
		['Shift+Arrow', () => selectFrom(editor, 6, 14)]
	] as const) {
		test(`typing over ${gesture} from the body start across a line break keeps both fences`, async () => {
			await editor.loadContent('```js\nconst x = 1;\nfoo();\n```\n');
			await select();
			await editor.page.keyboard.type('Q');

			await expect.poll(() => editor.bridge.getSource()).toBe('```js\nQoo();\n```\n');
		});
	}

	test('select-all then Backspace empties the body and keeps the code block', async () => {
		await editor.page.keyboard.press('ControlOrMeta+a');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('const x = 1');

		expect(await editor.bridge.getSource()).toBe('```js\n\n```\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
	});
});

// A range opening on the body's first highlighted word is where Chromium's own replace also
// removes the hidden opener, so each way of replacing a range is its own row.
// Display: opener [0,5) · body "const x = 1;\nfoo();\nbar();" [6,32) · closer [33,36).
const LONG = '```js\nconst x = 1;\nfoo();\nbar();\n```\n';
const ACROSS: [number, number] = [6, 21]; // from `const` into `foo`, across a line break
const REST = 'o();\nbar();';

type Step = (editor: EditorPage) => Promise<void>;
const typeQ: Step = (editor) => editor.page.keyboard.type('Q');
const composeA: Step = async (editor) => {
	const ime = await attachIme(editor.page);
	await ime.compose('あ');
	await ime.commit('あ');
};
const shiftAcross: Step = (editor) => selectFrom(editor, ACROSS[0], ACROSS[1] - ACROSS[0]);

const REPLACEMENTS: Array<[name: string, select: Step, replace: Step, body: string]> = [
	[
		'a typed key over a drag',
		(e) => e.dragFromTo([0], ACROSS[0], [0], ACROSS[1]),
		typeQ,
		'Q' + REST
	],
	['a typed key over Shift+Arrow', shiftAcross, typeQ, 'Q' + REST],
	['an emoji over Shift+Arrow', shiftAcross, (e) => e.page.keyboard.insertText('😀'), '😀' + REST],
	['an IME composition over Shift+Arrow', shiftAcross, composeA, 'あ' + REST],
	['an IME composition over the whole body', (e) => selectFrom(e, 6, 26), composeA, 'あ'],
	[
		'a typed key after Ctrl+A',
		async (e) => {
			await e.focusBlock(0, 10);
			await e.selectAll();
		},
		typeQ,
		'Q'
	]
];

test.describe('code block: any replacement of a body range keeps the hidden fence lines', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.setPresentationMode('live');
		await editor.loadContent(LONG);
		await editor.getBlock(0).click();
	});

	for (const [name, select, replace, body] of REPLACEMENTS) {
		test(`${name} replaces only body text`, async () => {
			await select(editor);
			await replace(editor);

			await expect.poll(() => editor.bridge.getSource()).toBe('```js\n' + body + '\n```\n');
		});
	}
});
