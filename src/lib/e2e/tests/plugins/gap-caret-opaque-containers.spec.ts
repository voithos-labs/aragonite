import { test, expect } from '../../fixtures';
import { PluginsPage, activeBlockPath, roundTripStable } from './helpers';

// The gap caret between opaque containers (#93): callout beside callout, details beside callout,
// and the case where a marker-prefixed container declines
// (requirements/plugins/gap-caret-opaque-containers.md). How a gap caret arrives, creates a block
// and undoes is covered in selection/gap-caret-*.spec.ts; the bytes are the reference here because
// an opaque container's raw is rebuilt rather than sliced.

const CALLOUT_A = ':::note Alpha\nalpha\n:::\n';
const CALLOUT_B = ':::tip Beta\nbeta\n:::\n';
/** admonition, admonition, paragraph: the boundary that qualifies is 1. */
const TWO_CALLOUTS = `${CALLOUT_A}\n${CALLOUT_B}\ntail\n`;
const OPEN_DETAILS = '<details open>\n<summary>Sum</summary>\n\nbody a\n\n</details>\n';
const CLOSED_DETAILS = '<details>\n<summary>Sum</summary>\n\nbody a\n\n</details>\n';
/** details, admonition, paragraph: the boundary that qualifies is 1. */
const DETAILS_THEN_CALLOUT = `${OPEN_DETAILS}\n${CALLOUT_B}\ntail\n`;
const COLLAPSED_THEN_CALLOUT = `${CLOSED_DETAILS}\n${CALLOUT_B}\ntail\n`;
/** blockquote, blockquote: the pinned case where no gap caret appears. */
const TWO_QUOTES = '> alpha\n\n> beta\n';
const AT_BOUNDARY = { parentPath: [], index: 1 };
const AT_DOC_START = { parentPath: [], index: 0 };

test.describe('gap caret between opaque containers', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
	});

	test('the fixtures are the block sequences the boundaries assume', async () => {
		await editor.loadContent(TWO_CALLOUTS);
		expect(await editor.bridge.getBlockKind(0)).toBe('admonition');
		expect(await editor.bridge.getBlockKind(1)).toBe('admonition');

		await editor.loadContent(DETAILS_THEN_CALLOUT);
		expect(await editor.bridge.getBlockKind(0)).toBe('details');
		expect(await editor.bridge.getBlockKind(1)).toBe('admonition');
	});

	test('ArrowDown out of the first callout puts the caret, typing creates between the two', async () => {
		await editor.loadContent(TWO_CALLOUTS);
		await editor.focusBlockAtPath([0, 1], 5);

		await editor.page.keyboard.press('ArrowDown');
		await editor.bridge.waitForGapCaret(AT_BOUNDARY);

		await editor.typeSlowly('X');
		await editor.bridge.waitForGapCaret(null);
		await editor.bridge.waitForSourceContains('\nX\n');
		expect(await editor.bridge.getSource()).toBe(`${CALLOUT_A}\nX\n\n${CALLOUT_B}\ntail\n`);
		expect(await roundTripStable(editor.page)).toBe(true);
	});

	test('one undo drops the new block byte-exactly and puts the caret back at the gap', async () => {
		await editor.loadContent(TWO_CALLOUTS);
		await editor.focusBlockAtPath([0, 1], 5);
		await editor.page.keyboard.press('ArrowDown');
		await editor.bridge.waitForGapCaret(AT_BOUNDARY);
		await editor.typeSlowly('X');
		await editor.bridge.waitForSourceContains('\nX\n');

		await editor.undo();

		await editor.bridge.waitForSourceEquals(TWO_CALLOUTS);
		await editor.bridge.waitForGapCaret(AT_BOUNDARY);
	});

	test('ArrowUp from the second callout title puts the caret, and again enters the callout above', async () => {
		await editor.loadContent(TWO_CALLOUTS);
		await editor.focusBlockAtPath([1, 0], 0);

		await editor.page.keyboard.press('ArrowUp');
		await editor.bridge.waitForGapCaret(AT_BOUNDARY);

		await editor.page.keyboard.press('ArrowUp');
		await editor.bridge.waitForGapCaret(null);
		await expect.poll(() => activeBlockPath(editor.page)).toEqual([0, 1]);
	});

	test('the details|callout boundary puts the caret and creates the same way', async () => {
		await editor.loadContent(DETAILS_THEN_CALLOUT);
		await editor.focusBlockAtPath([0, 1], 6);

		await editor.page.keyboard.press('ArrowDown');
		await editor.bridge.waitForGapCaret(AT_BOUNDARY);

		await editor.typeSlowly('Y');
		await editor.bridge.waitForGapCaret(null);
		await editor.bridge.waitForSourceContains('\nY\n');
		expect(await editor.bridge.getSource()).toBe(`${OPEN_DETAILS}\nY\n\n${CALLOUT_B}\ntail\n`);
		expect(await roundTripStable(editor.page)).toBe(true);
	});

	// The unmounted body has no reference, so the move must skip it and stop in the gap rather
	// than dead-end.
	test('ArrowDown from a collapsed details summary puts the caret at the boundary below', async () => {
		await editor.loadContent(COLLAPSED_THEN_CALLOUT);
		await editor.focusBlockAtPath([0, 0], 0);

		await editor.page.keyboard.press('ArrowDown');

		await editor.bridge.waitForGapCaret(AT_BOUNDARY);
		expect(await editor.bridge.getSource()).toBe(COLLAPSED_THEN_CALLOUT);
	});

	test('a click above a leading callout puts the caret at the document start', async () => {
		await editor.loadContent(TWO_CALLOUTS);
		const point = await editor.page.evaluate(() => {
			const root = document.querySelector('.editor')!.getBoundingClientRect();
			const first = document.querySelector("[data-block-path='[0]']")!.getBoundingClientRect();
			return { x: first.left + 8, y: (root.top + first.top) / 2 };
		});

		await editor.page.mouse.click(point.x, point.y);

		await editor.bridge.waitForGapCaret(AT_DOC_START);
	});

	// The other half of the decision: a marker-prefixed container keeps its unwrap and exit
	// gestures instead.
	test('blockquote|blockquote stays gap-free: ArrowDown enters the second quote', async () => {
		await editor.loadContent(TWO_QUOTES);
		await editor.focusBlockAtPath([0, 0], 5);

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		expect(await editor.bridge.getGapCaret()).toBeNull();
		await expect.poll(() => activeBlockPath(editor.page)).toEqual([1, 0]);
	});
});
