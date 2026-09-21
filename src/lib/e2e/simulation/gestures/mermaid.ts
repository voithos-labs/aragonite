import type { Page } from '@playwright/test';
import { type SimContext } from '../invariants';

// Mermaid gestures, for a block focused as a whole (plugins route only). The diagram is opaque
// and has no children, and asks for `blockFocus: 'whole-block'`, so arrows stop on it, a
// Backspace beside it focuses it before a second press deletes it, and Enter while it is
// focused inserts a paragraph below. Each waits for a focus or structural change and resyncs.

const VIEWPORT = '.mermaid-viewport';

// Focusing the block as a whole lands on the hidden editing host in the block's frame, not on
// the diagram the plugin declares, which a redraw replaces.
const FOCUS_HOST = '.mermaid-block [data-whole-block-input]';

async function waitForDiagramFocused(page: Page, timeout = 5000): Promise<void> {
	await page.waitForFunction(
		(selector) => document.activeElement === document.querySelector(selector),
		FOCUS_HOST,
		{ timeout, polling: 16 }
	);
}

async function diagramIsFocused(page: Page): Promise<boolean> {
	return page.evaluate(
		(selector) => document.activeElement === document.querySelector(selector),
		FOCUS_HOST
	);
}

async function assertUnchanged(ctx: SimContext, before: string, what: string): Promise<void> {
	// The arrow lands on the diagram, not on an editable element, so the editor records no
	// decision about the key.
	await ctx.editor.waitForNoSourceMutation();
	const now = await ctx.editor.bridge.getSource();
	if (now !== before) {
		throw new Error(
			`[${ctx.label}] ${what} changed the source.\n` +
				`EXPECTED: ${JSON.stringify(before)}\n` +
				`ACTUAL:   ${JSON.stringify(now)}`
		);
	}
}

/**
 * A diagram that swallowed the arrow, or let it pass straight through, would break navigation
 * without touching the source, so where the focus ends up is what this checks; the bytes being
 * unchanged is only a second check.
 */
export async function arrowFocusMermaid(ctx: SimContext, belowIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();

	await editor.clickBlock(belowIndex);
	await page.keyboard.press('ArrowUp');
	await waitForDiagramFocused(page);
	await assertUnchanged(ctx, before, 'arrow-focus');

	await page.keyboard.press('ArrowDown');
	if (await diagramIsFocused(page)) {
		throw new Error(`[${ctx.label}] ArrowDown did not step out of the focused diagram.`);
	}
	await assertUnchanged(ctx, before, 'arrow-exit');
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Waits on the `.block-host` count, not on the source changing: an empty paragraph may
 * serialize to nothing at all. Enter below is the one structural change available to a block
 * that is focused as a whole and has no children.
 */
export async function enterBelowUndoMermaid(ctx: SimContext): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const hostsBefore = await page.evaluate(() => document.querySelectorAll('.block-host').length);

	await page.locator(VIEWPORT).click();
	await waitForDiagramFocused(page);

	await page.keyboard.press('Enter');
	await editor.waitForBlockHostCount(hostsBefore + 1);

	await editor.undo();
	await editor.waitForBlockHostCount(hostsBefore);
	await editor.bridge.waitForSourceEquals(before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Deleting such a block takes two presses: the first only focuses it, which is what stops a
 * stray Backspace from below quietly swallowing it; the second deletes it in one commit, and
 * the closing undo shows that delete is a single reversible entry.
 */
export async function backspaceTwoStepDeleteUndoMermaid(
	ctx: SimContext,
	belowIndex: number
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();

	await editor.clickBlock(belowIndex);
	await page.keyboard.press('Home');

	await page.keyboard.press('Backspace');
	await waitForDiagramFocused(page);
	await assertUnchanged(ctx, before, 'first backspace (focus only)');

	await page.keyboard.press('Backspace');
	await editor.bridge.waitForSourceNotContains('```mermaid');

	await editor.undo();
	await editor.bridge.waitForSourceEquals(before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}
