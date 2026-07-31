import { type SimContext, assertStructuralIntegrity } from '../invariants';

// Native GitHub-alert container gestures (plugins route, `?seed=admonitions`). A `> [!TYPE]`
// blockquote is its own `githubAlert` strip container: the marker lives only in the container
// raw + metadata, and the bytes are NEVER rewritten to `:::`. Each gates on the promotion or
// structural change and resyncs; the merge and unwrap gestures assert the kind-stability and
// marker-drop boundaries the container's `unwrapRole` promises.

/**
 * Marker formation from live typing. Typed PER KEYSTROKE, so the editor sees the blockquote
 * promotion at `>`, the inline recognizer's `[` rung, and the alert reclassification at `]`
 * as three separate input events — a regression confined to those intermediate states is
 * invisible to an atomic insert. No second Enter: that would exit the quote. The body waits
 * on the alert kind, since reclassification must land the caret in the body first.
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
 * The merge must stay INSIDE the alert: kind and marker survive, the root count holds, and
 * only the alert's own child count drops. All four are asserted, so a regression in the
 * middle-child unwrapRole cannot record a corrupted tree as truth.
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
		{ timeout: 2000, polling: 16 }
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
 * `lift-first-child`: the alert loses its kind and its body reparses as a plain block.
 * Asserts exactly ONE alert vanished (robust to sibling alerts elsewhere in the session) and
 * that the `:::` form never appears.
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
 * A reorder WITHIN the alert: the body child permutes in place while kind, marker, root slot
 * and child count all hold. A regression to the teleport moves the whole alert among document
 * siblings or rebuilds it as a plain blockquote; both guards throw.
 */
export async function reorderGithubAlertBodyChild(
	ctx: SimContext,
	alertIndex: number,
	childIndex: number,
	dir: -1 | 1
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await alertShape(ctx, alertIndex);
	const beforeSource = await editor.bridge.getSource();

	await editor.clickBlockAtPath([alertIndex, childIndex], 0);
	await editor.waitForRenderFlush();
	await page.keyboard.press(dir < 0 ? 'Alt+ArrowUp' : 'Alt+ArrowDown');
	await editor.bridge.waitForSourceWith((source, prev) => source !== prev, beforeSource);

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
	tracker.resync(await editor.bridge.getSource());
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

/** The `> [!TYPE]` marker line off the alert's raw — the substring whose disappearance marks the unwrap. */
function markerText(shape: AlertShape): string {
	const nl = shape.raw.indexOf('\n');
	return nl < 0 ? shape.raw : shape.raw.slice(0, nl).replace(/\r$/, '');
}

async function waitForKindAt(ctx: SimContext, index: number, kind: string): Promise<void> {
	await ctx.page.waitForFunction(
		({ i, k }) => (window as any).__test.getDocument().children[i]?.kind === k,
		{ i: index, k: kind },
		{ timeout: 2000, polling: 16 }
	);
}
