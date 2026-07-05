import { type Page } from '@playwright/test';
import { type SimContext } from '../invariants';
import { primaryModifier } from '../../platform';

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

/**
 * Set the callout's kind via the minted `callout.setKind` chord — the corruption
 * oracle's only view of command dispatch (a keypress that bubbles from an inner
 * leaf to the container handler and commits a metadataUpdate). Reads the current
 * type and presses the chord for the OPPOSITE one (Mod+7→'note', Mod+8→'warning'),
 * then settles on the new opener bytes. Pressing the opposite type is what gives
 * the gesture teeth: a dead binding or a lost bubble leaves the source unchanged,
 * so the settle times out loudly instead of recording a stale source as truth —
 * the same fail-loud shape `toggleCollapse` uses. The change moves only
 * metadata/raw (kind stays `note`), so downstream index re-derivations hold.
 */
export async function setCalloutKind(ctx: SimContext): Promise<void> {
	const noteIdx = await topLevelNoteIndex(ctx.page);
	if (noteIdx < 0) throw new Error('setCalloutKind: no note callout in the document');

	const current = await calloutType(ctx.page, noteIdx);
	const next = current === 'warning' ? 'note' : 'warning';
	const chord = next === 'warning' ? '8' : '7';

	await ctx.editor.clickBlockAtPath([noteIdx, 1], 0);
	await ctx.page.keyboard.press(`${primaryModifier}+${chord}`);
	await ctx.editor.bridge.waitForSourceContains(`:::${next}`);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}

// Top-level index of the `note` callout — the type change keeps `kind: 'note'`,
// so this still resolves after a setKind.
async function topLevelNoteIndex(page: Page): Promise<number> {
	return page.evaluate(() =>
		(window as any).__test
			.getDocument()
			.children.findIndex((c: { kind?: string }) => c.kind === 'note')
	);
}

// Current callout type read off the opaque container's authoritative raw opener.
async function calloutType(page: Page, noteIdx: number): Promise<string> {
	return page.evaluate((i) => {
		const raw = ((window as any).__test.getDocument().children[i]?.raw ?? '') as string;
		return /^:::(\w+)/.exec(raw)?.[1] ?? '';
	}, noteIdx);
}
