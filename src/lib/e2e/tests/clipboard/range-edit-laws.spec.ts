import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { pointAtRaw } from '../../text-runs';
import { attachIme } from '../../simulation/ime';
import { isChromium } from '../../browser-engine';
import {
	RANGE_LAW_CASES,
	type CaseObserved,
	type CasePoint,
	type CaseStep,
	type OtherEngine,
	type RangeLawCase
} from '../../range-law-cases';

// The range-edit law cases the unit suite drives in jsdom (requirements/clipboard/range-edit-laws.md),
// here through real keys, a real clipboard and a real menu, against the same bytes.

async function select(editor: EditorPage, row: RangeLawCase): Promise<void> {
	const { anchor, focus, by } = row.select;
	if (by === 'setSelection') {
		await editor.focusBlockAtPath(anchor.path, anchor.offset);
		await editor.bridge.setSelection({ anchor, focus });
		return;
	}
	await editor.focusBlockAtPath(anchor.path, anchor.offset);
	const collapsed = anchor.path.join() === focus.path.join() && anchor.offset === focus.offset;
	if (!collapsed) await editor.shiftClickBlock(focus.path, focus.offset);
}

/** A point inside the selection, where a right-click keeps it: just past its anchor. */
const insideRange = (row: RangeLawCase): CasePoint => {
	const { anchor, focus } = row.select;
	const sameSpot = anchor.path.join() === focus.path.join() && anchor.offset === focus.offset;
	return sameSpot ? anchor : { path: anchor.path, offset: anchor.offset + 1 };
};

/** False when the row is disabled, which a press can't pick, so the gesture does nothing. */
async function pickMenuRow(editor: EditorPage, row: RangeLawCase, name: string): Promise<boolean> {
	const at = insideRange(row);
	const point = await pointAtRaw(editor.page, at.path, at.offset);
	await editor.page.mouse.click(point.x, point.y, { button: 'right' });
	const item = editor.page.getByRole('menuitem', { name, exact: true });
	if (await item.isDisabled()) return false;
	await item.click();
	return true;
}

async function run(editor: EditorPage, row: RangeLawCase, step: CaseStep): Promise<void> {
	const { page } = editor;
	switch (step.do) {
		case 'copy':
		case 'cut':
			if (step.route === 'menu') {
				if (!(await pickMenuRow(editor, row, step.do === 'copy' ? 'Copy' : 'Cut'))) return;
			} else await page.keyboard.press(`ControlOrMeta+${step.do === 'copy' ? 'c' : 'x'}`);
			await editor.waitForClipboardWrite();
			return;
		case 'paste':
			if (step.text !== undefined) await editor.seedClipboard(step.text);
			if (step.route === 'insertMarkdown') {
				await page.evaluate((md) => (window as any).__test.insertMarkdown(md), step.text ?? '');
			} else if (step.route === 'menu') await pickMenuRow(editor, row, 'Paste');
			else await editor.paste();
			return;
		case 'paste plain':
			await editor.seedClipboard(step.text);
			await pickMenuRow(editor, row, 'Paste as plain text');
			return;
		case 'type':
			if (step.route === 'composition') {
				const ime = await attachIme(page);
				await ime.compose(step.text);
				await ime.commit(step.text);
			} else await page.keyboard.type(step.text);
			return;
		case 'press':
			await page.keyboard.press(step.key);
			return;
		case 'undo':
			await editor.undo();
			return;
		case 'drop': {
			const from = await pointAtRaw(page, row.select.anchor.path, row.select.anchor.offset + 1);
			const to = await pointAtRaw(page, step.at.path, step.at.offset);
			await page.mouse.move(from.x, from.y);
			await page.mouse.down();
			await page.mouse.move(to.x, to.y, { steps: 10 });
			await page.mouse.up();
		}
	}
}

async function observe(editor: EditorPage, row: RangeLawCase): Promise<CaseObserved> {
	const seen: CaseObserved = { source: await editor.bridge.getSource() };
	if ('clipboard' in row.expected) seen.clipboard = await editor.readClipboard();
	if ('selection' in row.expected) {
		seen.selection = (await editor.bridge.getSelection()) as CaseObserved['selection'];
	}
	return seen;
}

test.describe('the range-edit law cases, in a browser', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.seedClipboard('');
	});

	for (const row of RANGE_LAW_CASES) {
		test(`${row.law}: ${row.name}${row.issue ? ` (${row.issue})` : ''}`, async ({
			page,
			browserName
		}) => {
			test.skip(row.only?.run === 'chromium' && !isChromium(page), row.only?.reason);
			const engine = browserName as OtherEngine;
			test.skip(!!row.skipIn?.[engine], row.skipIn?.[engine]);
			await editor.loadContent(row.source);
			await editor.setPresentationMode(row.mode);
			await select(editor, row);
			for (const step of row.steps) await run(editor, row, step);

			const want = row.todayIn?.[engine] ?? row.today ?? row.expected;
			await expect.poll(() => observe(editor, row)).toEqual(want);
			if (row.today) {
				expect(
					await observe(editor, row),
					'the row now keeps its law: delete its `today`'
				).not.toEqual(row.expected);
			}
		});
	}
});
