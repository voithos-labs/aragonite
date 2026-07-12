import type { Page } from '@playwright/test';
import { type SimContext } from '../invariants';

// Mermaid whole-block-focus gestures (plugins route only). The opaque childless
// diagram opts into `blockFocus: 'whole-block'`, so arrows stop on it, a
// caret-adjacent Backspace focuses before a second press deletes, and Enter while
// focused inserts a paragraph below. Free functions taking `ctx` first, mirroring
// gestures/math.ts. Each drives real keyboard/mouse, gates on an observable focus
// or structural signal, and resyncs the tracker — the diagram's source never
// round-trips through the ExpectationTracker's end-of-doc append rule.

const VIEWPORT = '.mermaid-viewport';

async function waitForViewportFocused(page: Page, timeout = 2000): Promise<void> {
	await page.waitForFunction(
		() => document.activeElement === document.querySelector('.mermaid-viewport'),
		null,
		{ timeout, polling: 16 }
	);
}

async function viewportIsFocused(page: Page): Promise<boolean> {
	return page.evaluate(
		() => document.activeElement === document.querySelector('.mermaid-viewport')
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
 * ArrowUp from the block below the diagram stops on it (whole-block focus, no byte
 * change); ArrowDown steps back out below. The arrow-stop is the traversal contract
 * an opaque childless block must honour — a diagram that swallowed the arrow or let
 * it pass straight through would break navigation without touching the source, so
 * the focus landing is the load-bearing assertion, byte-identity the guard.
 */
export async function arrowFocusMermaid(ctx: SimContext, belowIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();

	await editor.clickBlock(belowIndex);
	await page.keyboard.press('ArrowUp');
	await waitForViewportFocused(page);
	await assertUnchanged(ctx, before, 'arrow-focus');

	await page.keyboard.press('ArrowDown');
	if (await viewportIsFocused(page)) {
		throw new Error(`[${ctx.label}] ArrowDown did not step out of the focused diagram.`);
	}
	await assertUnchanged(ctx, before, 'arrow-exit');
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Focus the diagram by clicking it, then Enter to insert an empty paragraph below,
 * then undo — a net-identity structural detour. The insert is settled on the
 * `.block-host` count growing (an empty paragraph may serialize to no source delta),
 * and the undo on the count returning plus byte-exact source. Enter-below is the one
 * structural mutation the whole-block-focus model offers a childless container.
 */
export async function enterBelowUndoMermaid(ctx: SimContext): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const hostsBefore = await page.evaluate(() => document.querySelectorAll('.block-host').length);

	await page.locator(VIEWPORT).click();
	await waitForViewportFocused(page);

	await page.keyboard.press('Enter');
	await editor.waitForBlockHostCount(hostsBefore + 1);

	await editor.undo();
	await editor.waitForBlockHostCount(hostsBefore);
	await editor.bridge.waitForSourceEquals(before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Backspace at offset 0 in the block below the diagram: the first press focuses the
 * diagram without deleting (whole-block two-step, no byte change), the second
 * deletes it in one commit, and one undo restores it byte-exactly — a net-identity
 * delete detour. The two-step guard is what stops a stray Backspace from below from
 * silently eating an opaque block; the closing undo proves the delete is a single
 * reversible entry.
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
	await waitForViewportFocused(page);
	await assertUnchanged(ctx, before, 'first backspace (focus only)');

	await page.keyboard.press('Backspace');
	await editor.bridge.waitForSourceNotContains('```mermaid');

	await editor.undo();
	await editor.bridge.waitForSourceEquals(before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}
