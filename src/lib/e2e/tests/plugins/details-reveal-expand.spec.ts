import { test, expect } from '../../fixtures';
import type { Locator } from '@playwright/test';
import { DetailsPage, bodyHostCount, capturedErrors } from './details-helpers';
import { blockView, tocEntry } from './helpers';

/**
 * Scrolling to a block inside a collapsed container expands it
 * (requirements/plugins/details-reveal-expand.md). A collapsed `<details>` clamps its window to the
 * summary row, so aiming at a body child finds the target outside the mounted window and gives up,
 * leaving a dead outline click, unless the kind is asked to expand first. These tests prove that
 * expanding, mounting and scrolling compose on the real path, as one undo entry. The reading-mode
 * case is details-reveal.spec.ts.
 */

// A capped viewport makes the editor a real scroll container, so the collapsed section and its
// tail stay unmounted and the navigation click has real work to do.
test.use({ viewport: { width: 1000, height: 700 } });

// `[[toc]]` at block 0 so the entries have a stable locator, a visible heading, then a closed
// details whose body holds both a heading, the outline's target, and a word found nowhere else,
// the search target, and finally filler so the document scrolls.
function collapsedDoc(): string {
	const parts = [
		'[[toc]]',
		'# Visible Heading',
		...Array.from(
			{ length: 20 },
			(_, i) => `Intro paragraph ${i} with enough words to fill a line.`
		),
		'<details>\n<summary>Collapsed Section</summary>\n\n## Buried Heading\n\nZebra body text\n\n</details>',
		...Array.from({ length: 40 }, (_, i) => `Tail paragraph ${i} with enough words to fill a line.`)
	];
	return parts.join('\n\n') + '\n';
}

const DETAILS_INDEX = 22;
const BURIED_HEADING = [DETAILS_INDEX, 1];
const BODY_PARAGRAPH = [DETAILS_INDEX, 2];

class ExpandPage extends DetailsPage {
	entry(label: string): Locator {
		return tocEntry(this.page, label);
	}
	get toggle(): Locator {
		return this.page.locator('.details-toggle');
	}
	async load(md: string): Promise<void> {
		await this.gotoDetails();
		await this.loadContent(md);
	}
}

test.describe('plugin container: reveal expands a collapsed <details>', () => {
	let editor: ExpandPage;
	let source: string;

	test.beforeEach(async ({ page }) => {
		editor = new ExpandPage(page);
		source = collapsedDoc();
		await editor.load(source);
		// Precondition: the container is closed and its body really unmounted, so anything that
		// lands on a body child had to expand it first.
		expect(await editor.bridge.getSource()).toContain('<details>\n');
		expect(await bodyHostCount(page)).toBe(1);
		await expect(editor.toggle).toHaveAttribute('aria-expanded', 'false');
	});

	test('a toc click into the collapsed body expands it and scrolls the heading into view', async ({
		page
	}) => {
		await expect(editor.entry('Buried Heading')).toHaveCount(1);

		await editor.entry('Buried Heading').click();
		await editor.waitForRenderFlush();

		await editor.bridge.waitForSourceContains('<details open>');
		await expect(editor.toggle).toHaveAttribute('aria-expanded', 'true');
		await expect
			.poll(() => blockView(page, BURIED_HEADING))
			.toEqual({
				mounted: true,
				inView: true
			});
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('one undo collapses it back to the original bytes', async ({ page }) => {
		await editor.entry('Buried Heading').click();
		await editor.bridge.waitForSourceContains('<details open>');
		await editor.waitForUndoBatchFlush();

		// Straight to Ctrl+Z with no click first: the navigation puts the caret in the heading it
		// mounted, so the gesture that made the edit leaves focus where its undo can be typed.
		await editor.undo();
		await editor.waitForRenderFlush();

		// One entry, not two: a single Ctrl+Z restores the whole document byte-for-byte
		// and the clamp unmounts the body again.
		await expect.poll(() => editor.bridge.getSource()).toBe(source);
		await expect(editor.toggle).toHaveAttribute('aria-expanded', 'false');
		expect(await bodyHostCount(page)).toBe(1);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('search navigation into the collapsed body expands it the same way', async ({ page }) => {
		await editor.clickBlock(1);
		await page.keyboard.press('ControlOrMeta+f');
		await page.getByRole('textbox', { name: 'Find' }).click();
		await page.keyboard.type('Zebra');

		// The scan reaches the unmounted body, because search reads the CST, so mounting the body
		// paragraph is really attempted rather than never asked for.
		await expect(page.locator('.search-count')).toHaveText(/1\s*\/\s*1/);

		await editor.bridge.waitForSourceContains('<details open>');
		await expect
			.poll(() => blockView(page, BODY_PARAGRAPH))
			.toEqual({
				mounted: true,
				inView: true
			});
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('navigating into an already-open container does not re-commit', async ({ page }) => {
		const opened = source.replace('<details>\n', '<details open>\n');
		await editor.loadContent(opened);

		await editor.entry('Buried Heading').click();
		await editor.waitForRenderFlush();
		await expect
			.poll(() => blockView(page, BURIED_HEADING))
			.toEqual({
				mounted: true,
				inView: true
			});

		// No collapsed ancestor on the path, so nothing was expanded and the bytes are untouched.
		// An outline entry click, not a keystroke.
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(opened);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('reading mode does not expand: the reveal degrades as it did before the entry point', async ({
		page
	}) => {
		await editor.setPresentationMode('reading');

		await editor.entry('Buried Heading').click();
		await editor.waitForRenderFlush();
		await editor.waitForRenderFlush();

		expect(await editor.bridge.getSource()).toBe(source);
		await expect(editor.toggle).toHaveAttribute('aria-expanded', 'false');
		expect(await bodyHostCount(page)).toBe(1);
		expect(await capturedErrors(page)).toEqual([]);
	});
});
