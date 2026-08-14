import type { Page } from '@playwright/test';
import { type SimContext } from '../invariants';

// Mermaid whole-block-focus gestures (plugins route only). The opaque childless diagram opts
// into `blockFocus: 'whole-block'`, so arrows stop on it, a caret-adjacent Backspace focuses
// before a second press deletes, and Enter while focused inserts a paragraph below. Each
// gates on a focus or structural signal and resyncs — never predicts.

const VIEWPORT = '.mermaid-viewport';

// Whole-block focus lands on the editing host in the chrome box, not on the declared viewport,
// which a redraw replaces.
const FOCUS_HOST = '.mermaid-block [data-whole-block-input]';

async function waitForDiagramFocused(page: Page, timeout = 2000): Promise<void> {
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
 * A diagram that swallowed the arrow or let it pass straight through would break navigation
 * WITHOUT touching the source, so the focus landing is the load-bearing assertion here and
 * byte-identity is only the guard.
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
 * Settled on the `.block-host` COUNT, not a source delta: an empty paragraph may serialize to
 * no delta at all. Enter-below is the one structural mutation the whole-block-focus model
 * offers a childless container.
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
 * The whole-block TWO-STEP: the first press only focuses, which is what stops a stray
 * Backspace from below silently eating an opaque block; the second deletes in one commit and
 * the closing undo proves that delete is a single reversible entry.
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
