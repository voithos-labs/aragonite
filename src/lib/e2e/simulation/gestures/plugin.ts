import { type SimContext } from '../invariants';

// Plugin-container gestures. Free functions taking `ctx` first so the Gestures
// class can delegate without growing its frozen surface, mirroring gestures/table.ts.
//
// A live `<details>` renders its `.details-toggle` only on the plugins route
// (callout + details registered); sessions that drive this gesture must start
// from a loaded document containing a details container.

/**
 * Click the `<details>` collapse toggle and settle on the summary's
 * `aria-expanded` flipping to the opposite value. The toggle rewrites the opener
 * bytes (`<details open>` ↔ `<details>`) and mounts/unmounts the body — editor
 * auto-behavior, so the tracker adopts the observed source rather than predicting
 * it. Reading the pre-click state and settling on the OPPOSITE value makes a
 * silent no-op (a detached or unresponsive toggle) fail loudly on the timeout
 * instead of recording a stale source as truth.
 */
export async function toggleCollapse(ctx: SimContext): Promise<void> {
	const toggle = ctx.page.locator('.details-toggle').first();
	const wasExpanded = (await toggle.getAttribute('aria-expanded')) === 'true';
	await toggle.click();
	await ctx.page.waitForFunction(
		(want) => document.querySelector('.details-toggle')?.getAttribute('aria-expanded') === want,
		wasExpanded ? 'false' : 'true',
		{ timeout: 2000, polling: 16 }
	);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}
