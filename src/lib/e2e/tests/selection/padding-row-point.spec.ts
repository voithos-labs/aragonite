import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { pointAtRaw, pointInTopPadding, type Point } from '../../text-runs';

// A pointer gesture ending in the padding above an editable's first line lands at the column under
// it on that line, on every OS. Requirements: `e2e/requirements/selection/padding-row-point.md`.

const DOC =
	'Before\n\n```js\nconst x = 1;\nfoo();\n```\n\nHello world\n\n| A | B |\n| --- | --- |\n| hello | x |\n';
// `Be|fore`, the other end of every range here.
const START = { path: [0], offset: 2 };

interface Target {
	name: string;
	/** The editable whose own top padding the gesture ends in. */
	editable: string;
	/** Where the gesture lands: `con|st`, `Hel|lo`, `hel|lo`. */
	at: { path: number[]; offset: number };
}

const TARGETS: Target[] = [
	{
		name: 'a code block',
		editable: "[data-block-path='[1]'] .code-block",
		at: { path: [1], offset: 9 }
	},
	{
		name: 'a paragraph',
		editable: "[data-block-path='[2]'] [contenteditable='true']",
		at: { path: [2], offset: 3 }
	},
	{ name: 'a table cell', editable: '.table-cell >> nth=2', at: { path: [3, 1, 0], offset: 3 } }
];

type Gesture = 'drag end' | 'drag start' | 'shift-click' | 'click';

async function paddingPoint(page: Page, target: Target): Promise<Point> {
	const column = await pointAtRaw(page, target.at.path, target.at.offset);
	return pointInTopPadding(page.locator(target.editable), column.x);
}

async function drag(page: Page, from: Point, to: Point): Promise<void> {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 8 });
	await page.mouse.up();
}

async function perform(editor: EditorPage, gesture: Gesture, padding: Point): Promise<void> {
	const { page } = editor;
	const start = await pointAtRaw(page, START.path, START.offset);
	if (gesture === 'click') {
		await page.mouse.click(padding.x, padding.y);
	} else if (gesture === 'shift-click') {
		await page.mouse.click(start.x, start.y);
		await page.keyboard.down('Shift');
		await page.mouse.click(padding.x, padding.y);
		await page.keyboard.up('Shift');
	} else if (gesture === 'drag end') {
		await drag(page, start, padding);
	} else {
		await drag(page, padding, start);
	}
	await editor.waitForRenderFlush();
}

/** The selection each gesture should leave, with the padding's end at `at`. */
function expectedSelection(gesture: Gesture, at: Target['at']) {
	if (gesture === 'click') return { anchor: at, focus: at };
	if (gesture === 'drag start') return { anchor: at, focus: START };
	return { anchor: START, focus: at };
}

for (const target of TARGETS) {
	for (const gesture of ['drag end', 'drag start', 'shift-click', 'click'] as const) {
		// A range reaching a table from outside it names whole cells, so only a click has a column.
		if (target.name === 'a table cell' && gesture !== 'click') continue;
		test(`${gesture} in the top padding of ${target.name} lands at the column below`, async ({
			page
		}) => {
			// The browser places a plain press inside an editable itself, which the next slice takes over.
			test.fixme(gesture === 'click', 'slice 2: the native press in an editable’s own padding');
			const editor = new EditorPage(page);
			await editor.goto('?presentationMode=live');
			await editor.loadContent(DOC);

			await perform(editor, gesture, await paddingPoint(page, target));

			await expect
				.poll(() => editor.bridge.getSelectionPaths())
				.toEqual(expectedSelection(gesture, target.at));
		});
	}
}
