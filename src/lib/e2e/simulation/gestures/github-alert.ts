import { type SimContext, actThenResync, assertStructuralIntegrity } from '../invariants';

// Gestures for a native GitHub alert (plugins route, `?seed=admonitions`). A `> [!TYPE]`
// blockquote is its own `githubAlert` container: the marker lives only in the container's raw
// text and metadata, and the bytes are never rewritten to `:::`. Each waits for the block to
// change kind or shape and resyncs; the merge and unwrap gestures check that the kind holds
// and the marker goes, which is what the container's `unwrapRole` promises.

/**
 * The marker built by typing. Typed one key at a time, so the editor sees the blockquote form
 * at `>`, the inline handler for `[`, and the change to an alert at `]` as three separate input
 * events; a bug confined to those in-between states is invisible to a one-shot insert. No
 * second Enter, which would leave the quote. The body waits for the alert kind, since the
 * change of kind has to put the caret in the body first.
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
 * The merge has to stay inside the alert: the kind and marker survive, the document root keeps
 * its count, and only the alert's own child count drops. All four are checked, so a bug in how
 * a middle child unwraps cannot record a corrupted tree as if it were right.
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
 * `lift-first-child-drop-opener`: the alert loses its kind and its body reparses as a plain
 * block. Checks that exactly one alert disappeared, which holds even with other alerts in the
 * document, and that the `:::` form never appears.
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
 * A move inside the alert: the body child swaps places while the kind, the marker, the alert's
 * own position and its child count all hold. A bug that moved the whole alert among the
 * document's blocks, or rebuilt it as a plain blockquote, throws on one of those checks.
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
