import { type SimContext, actThenResync, assertStructuralIntegrity } from '../invariants';

// Gestures for a native GitHub alert (plugins route, `?seed=admonitions`). A `> [!TYPE]`
// blockquote is its own `githubAlert` container, and its bytes are never rewritten to `:::`. Each
// waits for the block to change kind or shape and resyncs; the merge and unwrap gestures check the
// kind and marker against what the container's `unwrapRole` promises.

/**
 * Typed key by key, so the blockquote at `>`, the inline handler at `[` and the alert at `]` arrive
 * as three input events a one-shot insert never produces; the body waits for the alert kind.
 */
export async function typeGithubAlert(
	ctx: SimContext,
	targetIndex: number,
	alertType: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION',
	body: string
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const alertIndex = targetIndex + 1;

	await editor.focusBlockEnd(targetIndex);
	await page.keyboard.press('Enter');
	await editor.typeSlowly('>');
	await waitForKindAt(ctx, alertIndex, 'blockquote');
	await editor.typeSlowly(`[!${alertType}]`);
	await waitForKindAt(ctx, alertIndex, 'githubAlert');
	await editor.waitForRenderFlush();
	await editor.typeSlowly(body);

	await editor.bridge.waitForSourceContains(`> [!${alertType}]\n> ${body}`);
	await waitForKindAt(ctx, alertIndex, 'githubAlert');
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * The merge stays inside the alert: kind, marker and the root's count hold and only the alert's
 * child count drops, so a middle child that unwraps wrongly throws.
 */
export async function mergeGithubAlertMiddleChild(
	ctx: SimContext,
	alertIndex: number,
	childIndex: number
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await alertShape(ctx, alertIndex);
	if (childIndex === 0) {
		throw new Error(`[${ctx.label}] mergeGithubAlertMiddleChild needs a non-first child`);
	}

	await editor.clickBlockAtPath([alertIndex, childIndex], 0);
	await page.keyboard.press('Home');
	await page.keyboard.press('Backspace');
	await page.waitForFunction(
		({ i, n }) => (window as any).__test.getDocument().children[i]?.children?.length === n,
		{ i: alertIndex, n: before.childCount - 1 },
		{ timeout: 5000, polling: 16 }
	);

	const after = await alertShape(ctx, alertIndex);
	if (after.rootCount !== before.rootCount || after.kind !== 'githubAlert' || !after.hasMarker) {
		throw new Error(
			`[${ctx.label}] middle-child merge escaped the alert or dropped the marker.\n` +
				`BEFORE: ${JSON.stringify(before)}\nAFTER:  ${JSON.stringify(after)}`
		);
	}
	await assertStructuralIntegrity(ctx);
	tracker.resync(await editor.bridge.getSource());
}

/**
 * `lift-first-child-drop-opener`: exactly one alert disappears (other alerts may exist) and its
 * body reparses as a plain block, never as the `:::` form.
 */
export async function unwrapGithubAlert(ctx: SimContext, alertIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const marker = markerText(await alertShape(ctx, alertIndex));
	const alertsBefore = (await docKinds(ctx)).filter((k) => k === 'githubAlert').length;

	await editor.clickBlockAtPath([alertIndex, 0], 0);
	await page.keyboard.press('Home');
	await page.keyboard.press('Backspace');
	await editor.bridge.waitForSourceNotContains(marker);

	const source = await editor.bridge.getSource();
	const alertsAfter = (await docKinds(ctx)).filter((k) => k === 'githubAlert').length;
	if (alertsAfter !== alertsBefore - 1 || source.includes(':::')) {
		throw new Error(
			`[${ctx.label}] unwrap did not drop exactly one githubAlert, or rewrote bytes to :::.\n` +
				`ALERTS: ${alertsBefore} → ${alertsAfter}\nSOURCE: ${JSON.stringify(source)}`
		);
	}
	await assertStructuralIntegrity(ctx);
	tracker.resync(await editor.bridge.getSource());
}

/**
 * The body child swaps places while the alert's kind, marker, position and child count hold, so
 * moving the whole alert or rebuilding it as a blockquote throws.
 */
export async function reorderGithubAlertBodyChild(
	ctx: SimContext,
	alertIndex: number,
	childIndex: number,
	dir: -1 | 1
): Promise<void> {
	const { page, editor } = ctx;
	const before = await alertShape(ctx, alertIndex);

	await editor.clickBlockAtPath([alertIndex, childIndex], 0);
	await editor.waitForRenderFlush();
	await actThenResync(ctx, () => page.keyboard.press(dir < 0 ? 'Alt+ArrowUp' : 'Alt+ArrowDown'));

	const after = await alertShape(ctx, alertIndex);
	if (
		after.rootCount !== before.rootCount ||
		after.kind !== 'githubAlert' ||
		!after.hasMarker ||
		after.childCount !== before.childCount
	) {
		throw new Error(
			`[${ctx.label}] alert body reorder escaped the container or dropped the marker.\n` +
				`BEFORE: ${JSON.stringify(before)}\nAFTER:  ${JSON.stringify(after)}`
		);
	}
	await assertStructuralIntegrity(ctx);
}

// ── Internal ────────────────────────────────────────────────────────────────

interface AlertShape {
	kind: string;
	childCount: number;
	rootCount: number;
	raw: string;
	hasMarker: boolean;
}

async function alertShape(ctx: SimContext, alertIndex: number): Promise<AlertShape> {
	return ctx.page.evaluate((i) => {
		const doc = (window as any).__test.getDocument();
		const node = doc.children[i];
		const raw = (node?.raw ?? '') as string;
		return {
			kind: (node?.kind ?? '') as string,
			childCount: node?.children?.length ?? 0,
			rootCount: doc.children.length,
			raw,
			hasMarker: /^> \[!/.test(raw)
		};
	}, alertIndex);
}

async function docKinds(ctx: SimContext): Promise<string[]> {
	return ctx.page.evaluate(() =>
		(window as any).__test.getDocument().children.map((c: { kind: string }) => c.kind)
	);
}

/** The `> [!TYPE]` marker line from the alert's raw text: the text whose loss marks the unwrap. */
function markerText(shape: AlertShape): string {
	const nl = shape.raw.indexOf('\n');
	return nl < 0 ? shape.raw : shape.raw.slice(0, nl).replace(/\r$/, '');
}

async function waitForKindAt(ctx: SimContext, index: number, kind: string): Promise<void> {
	await ctx.page.waitForFunction(
		({ i, k }) => (window as any).__test.getDocument().children[i]?.kind === k,
		{ i: index, k: kind },
		{ timeout: 5000, polling: 16 }
	);
}
