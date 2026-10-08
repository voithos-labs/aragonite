import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import { attachIme } from '../simulation/ime';

// Real IME composition over CDP, with genuine compositionstart/update/end events
// (requirements/ime-composition.md). The first test checks Chromium's order: every
// insertCompositionText fires with isComposing true before compositionend, and the commit to the
// tree comes from the block's own code, not another DOM input event (G1.27).

function countOf(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

test.describe('IME composition', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paragraph: source stays stable mid-composition; the commit lands once and round-trips', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await editor.focusBlockEnd(0);
		await page.evaluate(() => {
			const w = window as unknown as { __ime: string[] };
			w.__ime = [];
			const el = document.activeElement as HTMLElement;
			for (const type of ['compositionstart', 'compositionend']) {
				el.addEventListener(type, () => w.__ime.push(type));
			}
			el.addEventListener('input', (e) => w.__ime.push(`input:${(e as InputEvent).isComposing}`));
		});
		const ime = await attachIme(page);

		await ime.compose('か');
		await ime.compose('かん');
		expect(await editor.bridge.getSource()).toBe('hello world\n');

		await ime.commit('かん');
		await editor.bridge.waitForSourceContains('かん');
		const source = await editor.bridge.getSource();
		expect(countOf(source, 'かん')).toBe(1);
		expect(await page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);

		const events = await page.evaluate(() => (window as unknown as { __ime: string[] }).__ime);
		expect(events[0]).toBe('compositionstart');
		expect(events[events.length - 1]).toBe('compositionend');
		expect(events.slice(1, -1).every((e) => e === 'input:true')).toBe(true);
	});

	test('code block: composed commit lands in the body; Enter after it splices a newline', async ({
		page
	}) => {
		await editor.loadContent('```\ncode\n```\n');
		await editor.focusBlock(0, '```\ncode'.length);
		const ime = await attachIme(page);

		await ime.compose('か');
		await ime.compose('かん');
		expect(await editor.bridge.getSource()).toBe('```\ncode\n```\n');

		await ime.commit('かん');
		await editor.bridge.waitForSourceContains('codeかん');

		// The checks on insertLineBreak apply only while composing: once composition has ended,
		// Enter must put its newline into the body as usual.
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('codeかん\n\n```');
		expect(await page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	});

	test('table cell: composed commit updates the cell once and round-trips', async ({ page }) => {
		await editor.loadContent('| H |\n| :- |\n| Left |\n');
		await page.locator('.table-cell').nth(1).click();
		await page.keyboard.press('End');
		const ime = await attachIme(page);

		await ime.compose('か');
		await ime.compose('かん');
		expect(await editor.bridge.getSource()).toBe('| H |\n| :- |\n| Left |\n');

		await ime.commit('かん');
		await editor.bridge.waitForSourceContains('| Leftかん |');
		expect(countOf(await editor.bridge.getSource(), 'かん')).toBe(1);
		expect(await page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	});

	test('a composed commit over a selection replaces it, leaving one copy', async ({ page }) => {
		await editor.loadContent('hello world\n');
		await editor.focusBlockEnd(0);
		for (let i = 0; i < 'world'.length; i++) await page.keyboard.press('Shift+ArrowLeft');
		const ime = await attachIme(page);

		await ime.compose('かん');
		await ime.commit('かん');

		await editor.bridge.waitForSourceEquals('hello かん\n');
	});

	test('a composition over a range across blocks undoes with its removal in one step', async ({
		page
	}) => {
		await editor.loadContent('alpha\n\nbeta\n');
		// Drawn downward, so the caret stays in the first block, the one the removal keeps.
		await editor.focusBlock(0, 2);
		await page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);
		const ime = await attachIme(page);

		await ime.compose('かん');
		await ime.commit('かん');
		await editor.bridge.waitForSourceContains('かん');
		expect(countOf(await editor.bridge.getSource(), 'かん')).toBe(1);

		await editor.undo();
		await editor.bridge.waitForSourceEquals('alpha\n\nbeta\n');
	});

	test('undo after a composed commit restores the pre-composition text in one step', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await editor.focusBlockEnd(0);
		const ime = await attachIme(page);

		await ime.compose('かん');
		await ime.commit('かん');
		await editor.bridge.waitForSourceContains('かん');

		// One undo entry per composition: the commit goes through a single updateBlockContent,
		// whose debounced snapshot was taken before the composition started.
		await editor.undo();
		await editor.bridge.waitForSourceEquals('hello world\n');
	});
});

// ── Composing into an empty block ───────────────────────────────────────────

interface EmptyBlockRoute {
	name: string;
	source: string;
	/** Leaves the caret in an empty block the way a user gets there. */
	reach(editor: EditorPage): Promise<void>;
	/** The document once `text` is composed into that block. */
	after(text: string): string;
}

const enterAtEnd = async (editor: EditorPage): Promise<void> => {
	await editor.focusBlockEnd(0);
	await editor.page.keyboard.press('Enter');
};

/** Every route where the editor, not the browser, puts the caret into the empty block. */
const EDITOR_PLACED: EmptyBlockRoute[] = [
	{
		name: 'Enter at the end of a paragraph',
		source: 'hello\n',
		reach: enterAtEnd,
		after: (text) => `hello\n\n${text}\n`
	},
	{
		name: 'Backspace emptying a paragraph',
		source: 'x\n\na\n',
		async reach(editor) {
			await editor.focusBlockEnd(1);
			await editor.page.keyboard.press('Backspace');
		},
		after: (text) => `x\n\n${text}\n`
	},
	{
		name: 'arrows back into an empty paragraph',
		source: 'hello\n',
		async reach(editor) {
			await enterAtEnd(editor);
			await editor.page.keyboard.press('ArrowUp');
			await editor.page.keyboard.press('ArrowDown');
		},
		after: (text) => `hello\n\n${text}\n`
	},
	{
		name: 'Tab into an empty table cell',
		source: '| H | I |\n| - | - |\n| a |  |\n',
		async reach(editor) {
			await editor.page.locator('.table-cell').nth(2).click();
			await editor.page.keyboard.press('Tab');
		},
		after: (text) => `| H | I |\n| - | - |\n| a | ${text} |\n`
	},
	{
		name: 'Enter at the end of a quote',
		source: '> quote\n',
		reach: enterAtEnd,
		after: (text) => `> quote\n> ${text}\n`
	},
	{
		name: 'placeCaret into an empty document',
		source: '\n',
		reach: (editor) => editor.focusBlockStart(0),
		after: (text) => `${text}\n`
	}
];

/** Routes where the browser places the caret, or a marker span sits before the break. */
const CONTROLS: EmptyBlockRoute[] = [
	{
		name: 'a click into an empty document',
		source: '\n',
		reach: (editor) => editor.clickBlock(0),
		after: (text) => `${text}\n`
	},
	{
		name: 'Enter at the end of a list item',
		source: '- a\n',
		reach: enterAtEnd,
		after: (text) => `- a\n- ${text}\n`
	}
];

/** One candidate committed as is, and a romaji run converted on commit. */
const SEQUENCES = [
	{ name: 'a single update', updates: ['か'], commit: 'か' },
	{ name: 'several updates', updates: ['k', 'か', 'かん'], commit: '漢' }
];

for (const mode of ['source', 'live'] as const) {
	test.describe(`IME composition into an empty block (${mode})`, () => {
		for (const route of [...EDITOR_PLACED, ...CONTROLS]) {
			for (const sequence of SEQUENCES) {
				test(`${route.name}: ${sequence.name} commits once`, async ({ page }) => {
					const editor = new EditorPage(page);
					await editor.goto(mode === 'live' ? '?presentationMode=live' : '');
					await editor.loadContent(route.source);
					await route.reach(editor);
					const ime = await attachIme(page);

					for (const update of sequence.updates) await ime.compose(update);
					await ime.commit(sequence.commit);

					await expect.poll(() => editor.bridge.getSource()).toBe(route.after(sequence.commit));
				});
			}
		}
	});
}
