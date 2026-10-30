import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { enterPresentationMode } from './helpers';
import { PluginsPage } from '../plugins/helpers';
import { clickModeToggle } from '../../mode-switch';
import { textRunCenter } from '../../text-runs';

// Live mode: reading mode's marker-hiding CSS over an editable document, and markers that never
// show, which is what separates it from both preview modes.
// Requirements: e2e/requirements/presentation/presentation-live.md.

const DOC = [
	'# Title',
	'',
	'Some **bold** text',
	'',
	'- alpha',
	'1. one',
	'- [ ] task',
	'',
	'```js',
	'const x = 1;',
	'```',
	'',
	'| a | b |',
	'| --- | --- |',
	'| 1 | 2 |',
	'',
	'Visit [example](https://example.com) here',
	'',
	'Also [docs][ref] here',
	'',
	'[ref]: https://example.com/docs',
	'',
	// Appended, never spliced: the scenarios above address blocks by index.
	'See <https://commonmark.org> too'
].join('\n');

// Directives render only on `/test/plugins`, so the container-marker case is driven there. Titled,
// so its opener line holds more than markers and only the line's own rule can show them.
const DIRECTIVE_DOC = ':::foo Bar\nBody with **bold** here.\n:::\n';

const AMBIENT_MARKER = ".md-marker[contenteditable='false']";

const enterLive = (page: Page) => enterPresentationMode(page, 'live', DOC);

test.describe('live mode: markers never reveal', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	test('every marker family hides from paint while its bytes stay in the DOM', async ({ page }) => {
		// toHaveCSS, not toBeHidden: a missing element passes toBeHidden, so a fixture that
		// stopped producing one of these spans would drop the check silently.
		await expect(ep.getBlock(1).locator('.md-marker').first()).toHaveCSS('display', 'none');
		await expect(page.locator('.md-fence-line').first()).toHaveCSS('display', 'none');
		await expect(page.locator('.md-ref-label').first()).toHaveCSS('display', 'none');
		await expect(ep.getBlock(0).locator('.md-marker').first()).toHaveCSS('display', 'none');

		// The coordinate-space contract: hidden, never omitted.
		expect(await ep.getBlockText(0)).toBe('# Title');
		expect(await ep.getBlockText(1)).toBe('Some **bold** text');
	});

	test('an angle autolink hides its brackets and shows the bare url', async () => {
		const block = ep.getBlocks().filter({ hasText: 'commonmark.org' });
		const brackets = block.locator('.md-marker');

		await expect(brackets).toHaveCount(2);
		await expect(brackets.first()).toHaveCSS('display', 'none');
		await expect(brackets.last()).toHaveCSS('display', 'none');
		await expect(block.locator('a.md-autolink')).toHaveText('https://commonmark.org');

		expect(await block.textContent()).toBe('See <https://commonmark.org> too');
	});

	test('the caret inside a block reveals neither the block nor its construct', async ({ page }) => {
		const headingMarker = ep.getBlock(0).locator('.md-marker').first();
		const emphasisMarkers = ep.getBlock(1).locator('.md-marker');

		const point = await textRunCenter(page, 'bold');
		await page.mouse.click(point.x, point.y);
		await ep.waitForRenderFlush();
		expect((await ep.bridge.getSelectionPaths())?.focus.path).toEqual([1]);

		// preview-block would show both emphasis markers here, preview-inline the pair the caret
		// sits between. Live shows neither, and the heading's `#` stays hidden too.
		await expect(emphasisMarkers.first()).toHaveCSS('display', 'none');
		await expect(emphasisMarkers.nth(1)).toHaveCSS('display', 'none');
		await expect(headingMarker).toHaveCSS('display', 'none');
	});

	test('list markers: bullet paints chrome, ordered stays visible, task keeps its checkbox', async ({
		page
	}) => {
		await expect(
			page.locator(`[data-list-marker='ordered'] ${AMBIENT_MARKER}`).first()
		).toBeVisible();
		await expect(page.locator(`[data-list-marker='task'] .task-checkbox`).first()).toBeVisible();

		const bulletAmbient = page.locator(`[data-list-marker='bullet'] ${AMBIENT_MARKER}`).first();
		// toBeHidden here on purpose: the bullet's span is not display:none but emptied and repainted
		// by its box's `::before`, and its presence is asserted below.
		await expect(bulletAmbient).toBeHidden();
		const painted = await bulletAmbient.evaluate(
			(el) => getComputedStyle(el.querySelector('.md-marker-box')!, '::before').content
		);
		expect(painted).toContain('•');
	});

	test('the header toggle round-trips live and leaves the bytes untouched', async ({ page }) => {
		const baseline = await ep.bridge.getSource();

		await clickModeToggle(page, 'live'); // live → source
		await expect(ep.getBlock(0).locator('.md-marker').first()).toBeVisible();

		await clickModeToggle(page, 'live');
		// A header-toggle click, not a keystroke.
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(baseline);
	});
});

test.describe('live mode: the surface stays editable', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	test('typing into a paragraph commits the bytes', async () => {
		await ep.clickBlock(1);
		await ep.typeText('EDIT');
		await ep.bridge.waitForSourceContains('EDIT');
	});

	test('the task checkbox toggles, unlike reading mode', async ({ page }) => {
		await page.locator('.task-checkbox').first().click();
		await ep.bridge.waitForSourceContains('- [x] task');
	});

	test('a plain click on a link places a caret instead of navigating', async ({
		context,
		page
	}) => {
		let popupFired = false;
		context.on('page', () => {
			popupFired = true;
		});
		await page.locator('a.md-link-content').first().click();
		await ep.waitForRenderFlush();

		expect((await ep.bridge.getSelectionPaths())?.focus.path).toEqual([7]);
		// 200ms, because a popup that never opens leaves no state to wait on.
		await page.waitForTimeout(200);
		expect(popupFired).toBe(false);
	});

	// The table is the document's clearest place to show a drag handle, since a plain paragraph
	// has none, and it is the only way to drag a table, so it is the one live must not swallow.
	test('the block drag handle still reveals on hover', async ({ page }) => {
		const host = page.locator('.block-host[data-block-kind="table"]').first();
		await host.hover();
		await expect(host.locator(':scope > .block-drag-handle').first()).toHaveCSS('opacity', '1');
	});
});

// The bridge is the third way into live mode (the query param and the toggle are covered above),
// and the only one that reaches the plugin harness where directive containers render.
test.describe('live mode: plugin container chrome', () => {
	test('an opener line shows its source only while the caret is on it', async ({ page }) => {
		const ep = new PluginsPage(page);
		await ep.gotoPlugins();
		await ep.loadContent(DIRECTIVE_DOC);
		await ep.setPresentationMode('live');
		await ep.waitForRenderFlush();

		const opener = page.locator('.directive-opener-line');
		const openerMarker = opener.locator('.md-marker');
		await expect(openerMarker).toHaveCSS('display', 'none');
		// The generic container draws its `:::foo` in place of the hidden one, so the line looks the
		// same with the caret on it or off it.
		expect(await opener.evaluate((el) => getComputedStyle(el, '::before').content)).toBe(
			'":::foo "'
		);

		// The caret in the body shows neither the body's markers nor the opener line's.
		await page.locator('.directive-block [contenteditable="true"]', { hasText: /bold/ }).click();
		await expect(page.locator('.directive-block .md-marker').last()).toHaveCSS('display', 'none');
		await expect(openerMarker).toHaveCSS('display', 'none');

		// The caret on the opener line shows its own `:::foo`, and the drawn copy steps aside.
		await ep.focusBlockAtPath([0, 0], 10);
		await expect(openerMarker).not.toHaveCSS('display', 'none');
		expect(await opener.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none');
	});

	test("an admonition shows its icon and title, or its kind's name, off the line", async ({
		page
	}) => {
		const ep = new PluginsPage(page);
		await ep.gotoPlugins();
		await ep.loadContent(':::note Heads up\nOne.\n:::\n\n:::tip\nTwo.\n:::\n');
		await ep.setPresentationMode('live');
		await ep.waitForRenderFlush();

		const titled = page.locator('.admonition[data-kind="note"] .directive-opener-line');
		const untitled = page.locator('.admonition[data-kind="tip"] .directive-opener-line');
		const label = (row: typeof titled) =>
			row.evaluate((el) => getComputedStyle(el, '::after').content);
		await expect(titled.locator('.md-marker')).toHaveCSS('display', 'none');
		await expect(untitled.locator('.md-marker')).toHaveCSS('display', 'none');
		expect(await label(untitled)).toBe('"Tip"');
		// The icon is the line's own ::before, so it paints whatever the line's marker does.
		expect(await titled.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('""');

		// On the line, the untitled tip shows its `:::tip` source and no stand-in name.
		await ep.focusBlockAtPath([1, 0], 6);
		await expect(untitled.locator('.md-marker')).not.toHaveCSS('display', 'none');
		expect(await label(untitled)).toBe('none');
		await ep.focusBlockAtPath([0, 0], 16);
		await expect(titled.locator('.md-marker')).not.toHaveCSS('display', 'none');
		expect(await label(untitled)).toBe('"Tip"');
	});
});
