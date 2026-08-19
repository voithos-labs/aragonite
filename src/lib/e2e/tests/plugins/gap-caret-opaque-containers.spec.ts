import { test, expect } from '../../fixtures';
import { PluginsPage, activeBlockPath, roundTripStable } from './helpers';

// Gap caret on the opaque-container tier (#93): callout|callout, details|callout, and the
// strip negative (requirements/plugins/gap-caret-opaque-containers.md). The generic
// arrival/mint/undo mechanics live in selection/gap-caret-*.spec.ts; bytes are the oracle
// here because opaque raws are rebuilt, not sliced.

const CALLOUT_A = ':::note Alpha\nalpha\n:::\n';
const CALLOUT_B = ':::tip Beta\nbeta\n:::\n';
/** admonition, admonition, paragraph — the eligible boundary is 1. */
const TWO_CALLOUTS = `${CALLOUT_A}\n${CALLOUT_B}\ntail\n`;
const OPEN_DETAILS = '<details open>\n<summary>Sum</summary>\n\nbody a\n\n</details>\n';
const CLOSED_DETAILS = '<details>\n<summary>Sum</summary>\n\nbody a\n\n</details>\n';
/** details, admonition, paragraph — the eligible boundary is 1. */
const DETAILS_THEN_CALLOUT = `${OPEN_DETAILS}\n${CALLOUT_B}\ntail\n`;
const COLLAPSED_THEN_CALLOUT = `${CLOSED_DETAILS}\n${CALLOUT_B}\ntail\n`;
/** blockquote, blockquote — the strip tier's pinned non-boundary. */
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

	test('ArrowDown out of the first callout parks, typing mints between the two', async () => {
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

	test('one undo drops the mint byte-exactly and re-parks the gap', async () => {
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

	test('ArrowUp from the second callout title parks, and again enters the callout above', async () => {
		await editor.loadContent(TWO_CALLOUTS);
		await editor.focusBlockAtPath([1, 0], 0);

		await editor.page.keyboard.press('ArrowUp');
		await editor.bridge.waitForGapCaret(AT_BOUNDARY);

		await editor.page.keyboard.press('ArrowUp');
		await editor.bridge.waitForGapCaret(null);
		await expect.poll(() => activeBlockPath(editor.page)).toEqual([0, 1]);
	});

	test('the details|callout boundary parks and mints the same way', async () => {
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

	// The clamped-out body is refless; the move must skip it and park, not dead-end.
	test('ArrowDown from a collapsed details summary parks at the boundary below', async () => {
		await editor.loadContent(COLLAPSED_THEN_CALLOUT);
		await editor.focusBlockAtPath([0, 0], 0);

		await editor.page.keyboard.press('ArrowDown');

		await editor.bridge.waitForGapCaret(AT_BOUNDARY);
		expect(await editor.bridge.getSource()).toBe(COLLAPSED_THEN_CALLOUT);
	});

	test('a click above a leading callout parks at the document start', async () => {
		await editor.loadContent(TWO_CALLOUTS);
		const point = await editor.page.evaluate(() => {
			const root = document.querySelector('.editor')!.getBoundingClientRect();
			const first = document.querySelector("[data-block-path='[0]']")!.getBoundingClientRect();
			return { x: first.left + 8, y: (root.top + first.top) / 2 };
		});

		await editor.page.mouse.click(point.x, point.y);

		await editor.bridge.waitForGapCaret(AT_DOC_START);
	});

	// The decision's other half: the strip tier keeps its unwrap/exit gestures instead.
	test('blockquote|blockquote stays gap-free: ArrowDown enters the second quote', async () => {
		await editor.loadContent(TWO_QUOTES);
		await editor.focusBlockAtPath([0, 0], 5);

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		expect(await editor.bridge.getGapCaret()).toBeNull();
		await expect.poll(() => activeBlockPath(editor.page)).toEqual([1, 0]);
	});
});
