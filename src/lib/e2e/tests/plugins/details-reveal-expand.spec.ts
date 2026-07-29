import { test, expect } from '../../fixtures';
import type { Locator, Page } from '@playwright/test';
import { primaryModifier } from '../../platform';
import { DetailsPage, bodyHostCount, capturedErrors } from './details-helpers';

/**
 * Reveal into a collapsed container expands it (requirements/plugins/details-reveal-expand.md).
 * A collapsed `<details>` clamps its window to the summary row, so a reveal aimed at a
 * body child used to find its target outside the live window and return — a dead toc
 * click. The reveal seam now opens the kind's declared expand door first and commits it,
 * so the target mounts and scrolls. The decision itself is unit-covered; what this gate
 * proves is that expand → mount → scroll compose on the real navigation path, and that
 * the committed expansion is exactly one undo entry.
 *
 * The reading-mode floor (a reveal that must NOT commit) stays in `details-reveal.spec.ts`.
 */

// Capped viewport → the editor is a real scroll container, so the collapsed section and
// its tail window out and the navigation click has real work to do.
test.use({ viewport: { width: 1000, height: 700 } });

// `[[toc]]` at block 0 (stable entry locator), a visible heading, then a CLOSED details
// whose body holds both a heading (the toc target) and a needle found nowhere else (the
// search target), then filler so the document scrolls.
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

interface TestWindow {
	__test: {
		startErrorCapture(): void;
		setPresentationMode(mode: string): void;
	};
}

class ExpandPage extends DetailsPage {
	entry(label: string): Locator {
		return this.page.locator("[data-block-path='[0]'] .toc-block-item").filter({ hasText: label });
	}
	get toggle(): Locator {
		return this.page.locator('.details-toggle');
	}
	async load(md: string): Promise<void> {
		await this.gotoDetails();
		await this.loadContent(md);
		await this.page.evaluate(() => (window as unknown as TestWindow).__test.startErrorCapture());
	}
}

// In-view = the block's box intersects the editor viewport. Addressed by nested path and
// measured independently of `scrollTo`'s own report, so the assertion isn't tautological.
function blockView(page: Page, path: number[]): Promise<{ mounted: boolean; inView: boolean }> {
	return page.evaluate((p) => {
		const er = (document.querySelector('.editor') as HTMLElement).getBoundingClientRect();
		const block = document.querySelector(
			`[data-block-path='${JSON.stringify(p)}']`
		) as HTMLElement | null;
		if (!block) return { mounted: false, inView: false };
		const br = block.getBoundingClientRect();
		return { mounted: true, inView: br.top < er.bottom && br.bottom > er.top };
	}, path);
}

test.describe('plugin container: reveal expands a collapsed <details>', () => {
	let editor: ExpandPage;
	let source: string;

	test.beforeEach(async ({ page }) => {
		editor = new ExpandPage(page);
		source = collapsedDoc();
		await editor.load(source);
		// Precondition: the container is closed and its body genuinely unmounted, so a
		// reveal that lands a body child had to expand it.
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

		// Straight to Ctrl+Z, with no click to put the caret back first: the navigation
		// lands it in the revealed heading, so the gesture that made the edit leaves
		// focus where the undo for it can be typed.
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
		await page.keyboard.press(`${primaryModifier}+f`);
		await page.getByRole('textbox', { name: 'Find' }).click();
		await page.keyboard.type('Zebra');

		// The scan reaches the unmounted body (search reads the CST), so the reveal of the
		// body paragraph is genuinely attempted rather than vacuously absent.
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

		// No collapsed ancestor on the path → no door opened, so the bytes are untouched.
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(opened);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('reading mode does not expand — the reveal degrades as it did before the door', async ({
		page
	}) => {
		await page.evaluate(() =>
			(window as unknown as TestWindow).__test.setPresentationMode('reading')
		);
		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'reading');

		await editor.entry('Buried Heading').click();
		await editor.waitForRenderFlush();
		await editor.waitForRenderFlush();

		// Reading mode commits nothing: the container stays closed, the body stays
		// unmounted, and the document is byte-identical.
		expect(await editor.bridge.getSource()).toBe(source);
		await expect(editor.toggle).toHaveAttribute('aria-expanded', 'false');
		expect(await bodyHostCount(page)).toBe(1);
		expect(await capturedErrors(page)).toEqual([]);
	});
});
