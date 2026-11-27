import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import { edgeKey, WORD_MODIFIER } from '../../platform-keys';

/**
 * A word or line delete on a `:::` container's opener row: in live mode one from a title set apart
 * from the name stops at the title's start, and with nothing left takes nothing, so the row stays an
 * opener; an untitled row's end and source mode delete as text. A line delete that takes the row's
 * colons unwraps the box, as removing the same selection does.
 */

const T = ':::tip T\nbody\n:::\n';
const TWO = ':::tip Two words\nbody\n:::\n';
const EMPTIED = ':::tip \nbody\n:::\n';
const U = ':::tip\nbody\n:::\n';
const WORD_BACK = `${WORD_MODIFIER}+Backspace`;

type Step = { key: string } | { input: string } | { at: [number[], number] } | { type: string };

interface Row {
	name: string;
	source: string;
	mode: 'live' | 'source';
	steps: Step[];
	bytes: string;
	/** Whether the last step wrote nothing: no undo entry joins the ones before it. */
	nothing?: true;
}

const toRowEnd: Step[] = [{ at: [[0, 1], 0] }, { key: 'ArrowUp' }, { key: edgeKey('lineEnd') }];

const ROWS: Row[] = [
	{
		name: 'a word delete at an emptied title takes nothing; the next letter is the title',
		source: T,
		mode: 'live',
		steps: [...toRowEnd, { key: 'Backspace' }, { key: WORD_BACK }, { type: 'x' }],
		bytes: ':::tip x\nbody\n:::\n'
	},
	{
		name: 'a word delete at a loaded empty title takes nothing',
		source: EMPTIED,
		mode: 'live',
		steps: [...toRowEnd, { key: WORD_BACK }],
		bytes: EMPTIED,
		nothing: true
	},
	{
		name: 'word deletes clearing a two-word title stop at its start',
		source: TWO,
		mode: 'live',
		steps: [...toRowEnd, { key: WORD_BACK }, { key: WORD_BACK }, { key: WORD_BACK }],
		bytes: EMPTIED
	},
	{
		name: 'a word delete at a titled row’s title start takes nothing',
		source: T,
		mode: 'live',
		steps: [{ at: [[0, 1], 0] }, { key: 'ArrowUp' }, { key: WORD_BACK }],
		bytes: T,
		nothing: true
	},
	{
		name: 'a line delete from the title’s end clears the title, the box kept',
		source: T,
		mode: 'live',
		steps: [...toRowEnd, { input: 'deleteSoftLineBackward' }],
		bytes: EMPTIED
	},
	{
		name: 'a word delete at an untitled row’s end deletes the name as text',
		source: U,
		mode: 'live',
		steps: [...toRowEnd, { key: WORD_BACK }],
		bytes: ':::\nbody\n:::\n'
	},
	{
		name: 'Backspace three times then a name renames an untitled row',
		source: U,
		mode: 'live',
		steps: [
			...toRowEnd,
			{ key: 'Backspace' },
			{ key: 'Backspace' },
			{ key: 'Backspace' },
			{ type: 'note' }
		],
		bytes: ':::note\nbody\n:::\n'
	},
	{
		name: 'source mode: a word delete at an emptied title deletes as text',
		source: EMPTIED,
		mode: 'source',
		steps: [...toRowEnd, { key: WORD_BACK }],
		bytes: ':::\nbody\n:::\n'
	},
	{
		name: 'source mode: a line delete over the whole row unwraps the box',
		source: T,
		mode: 'source',
		steps: [...toRowEnd, { input: 'deleteSoftLineBackward' }],
		bytes: 'body\n'
	}
];

async function run(page: Page, editor: PluginsPage, row: Row): Promise<number> {
	await editor.gotoPlugins('admonitions');
	await editor.loadContent(row.source);
	await editor.setPresentationMode(row.mode);
	let depth = 0;
	for (const [i, step] of row.steps.entries()) {
		if (i === row.steps.length - 1) depth = await undoDepth(page);
		if ('at' in step) await editor.focusBlockAtPath(step.at[0], step.at[1]);
		else if ('key' in step) await page.keyboard.press(step.key);
		else if ('type' in step) await page.keyboard.type(step.type);
		else await keylessDelete(page, step.input);
		await editor.waitForRenderFlush();
	}
	return depth;
}

const undoDepth = (page: Page): Promise<number> =>
	page.evaluate(() => (window as any).__test.undoDepth() as number);

async function keylessDelete(page: Page, inputType: string): Promise<void> {
	await page.evaluate((type) => {
		(document.activeElement as HTMLElement).dispatchEvent(
			new InputEvent('beforeinput', { inputType: type, bubbles: true, cancelable: true })
		);
	}, inputType);
}

test.describe('a word or line delete on a `:::` opening row', () => {
	for (const row of ROWS) {
		test(row.name, async ({ page }) => {
			const editor = new PluginsPage(page);
			const before = await run(page, editor, row);
			await expect.poll(() => editor.bridge.getSource()).toBe(row.bytes);
			if (row.nothing) expect(await undoDepth(page)).toBe(before);
		});
	}
});
