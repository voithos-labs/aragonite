import { settleTypedSource, undoStackDepth, type SimContext } from '../invariants';

/**
 * Live-mode editing gestures. Each enters live through the header toggle, drives one live-only
 * rule with real keys, and undoes it — in the single press the rule is contracted to cost, or by
 * the entries a typed run spent — so each is net-identity and a note fixture can fire it
 * mid-session. The source is the oracle throughout: live paints no delimiter, so the bytes are
 * the only witness that the rule fired on runs the reader never saw.
 */

const CARD = '[data-link-card]';

export type LiveFormat = 'strong' | 'strikethrough' | 'inlineCode';

const FORMAT_CHORD: Record<LiveFormat, string> = {
	strong: 'ControlOrMeta+b',
	strikethrough: 'ControlOrMeta+Shift+X',
	inlineCode: 'ControlOrMeta+e'
};

const FORMAT_DELIMITER: Record<LiveFormat, string> = {
	strong: '**',
	strikethrough: '~~',
	inlineCode: '`'
};

// ── The mode envelope ───────────────────────────────────────────────────────

/** Enter live, run, leave. The toggle is a real click both ways and the source must come back
 *  byte-identical, which is the flip family's contract with live's rules in between. */
async function inLiveMode(ctx: SimContext, run: () => Promise<void>): Promise<void> {
	const { page, editor, tracker } = ctx;
	// Fences the gesture's own edit into a fresh undo batch, so the single undo it closes with
	// reverses exactly it rather than overshooting into whatever typed before.
	await editor.waitForUndoBatchFlush();
	const before = await editor.bridge.getSource();
	const toggle = page.getByTestId('live-toggle');

	await toggle.click();
	await page.waitForSelector('.editor[data-presentation="live"]', { timeout: 2000 });
	try {
		await run();
	} finally {
		await toggle.click();
		await page.waitForSelector('.editor:not([data-presentation])', { timeout: 2000 });
	}
	await editor.bridge.waitForSourceEquals(before, 3000);
	tracker.resync(before);
}

// ── Gestures ────────────────────────────────────────────────────────────────

/** Select `word` and toggle a mark over the selection: bytes land immediately, as their own
 *  undo entry — the collapsed-caret half of the same chord pends instead and writes nothing. */
export async function liveToggleFormat(
	ctx: SimContext,
	blockIndex: number,
	word: string,
	format: LiveFormat
): Promise<void> {
	await inLiveMode(ctx, async () => {
		const before = await ctx.editor.bridge.getSource();
		await selectWord(ctx, blockIndex, word);
		await ctx.page.keyboard.press(FORMAT_CHORD[format]);
		await ctx.editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);

		const fence = FORMAT_DELIMITER[format];
		const wrapped = `${fence}${word}${fence}`;
		const after = await ctx.editor.bridge.getSource();
		if (!after.includes(wrapped)) {
			throw new Error(
				`[${ctx.label}] live ${format} toggle did not wrap the selection.\n` +
					`EXPECTED to contain: ${JSON.stringify(wrapped)}\nACTUAL: ${JSON.stringify(after)}`
			);
		}
		await undoOnceTo(ctx, before, `live ${format} toggle`);
	});
}

/** Backspace at a construct's trailing CONTENT edge takes the character the reader sees, never
 *  the delimiter behind it — the byte native editing would have taken there. */
export async function liveEdgeBackspace(
	ctx: SimContext,
	blockIndex: number,
	content: string
): Promise<void> {
	await inLiveMode(ctx, async () => {
		const before = await ctx.editor.bridge.getSource();
		const raw = await blockRaw(ctx, blockIndex);
		await seatCaret(ctx, blockIndex, indexOfIn(ctx, raw, content) + content.length);
		await ctx.page.keyboard.press('Backspace');
		await ctx.editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);

		const shortened = content.slice(0, -1);
		const after = await ctx.editor.bridge.getSource();
		if (!after.includes(shortened) || after.includes(content)) {
			throw new Error(
				`[${ctx.label}] live edge Backspace did not take the last CONTENT character.\n` +
					`EXPECTED ${JSON.stringify(content)} to become ${JSON.stringify(shortened)}\n` +
					`ACTUAL: ${JSON.stringify(after)}`
			);
		}
		await undoOnceTo(ctx, before, 'live edge Backspace');
	});
}

/** Backspace at a heading's content start gives up the prefix the mode paints nothing for,
 *  before any merge — the demote-first policy, reachable only where `# ` is unpainted. */
export async function liveDemoteHeading(ctx: SimContext, blockIndex: number): Promise<void> {
	await inLiveMode(ctx, async () => {
		const before = await ctx.editor.bridge.getSource();
		const raw = await blockRaw(ctx, blockIndex);
		if (!raw.startsWith('#')) {
			throw new Error(`[${ctx.label}] block ${blockIndex} is not an ATX heading: ${raw}`);
		}
		await ctx.editor.clickBlock(blockIndex);
		await ctx.page.keyboard.press('Home');
		await ctx.editor.waitForRenderFlush();
		await ctx.page.keyboard.press('Backspace');
		await ctx.editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);

		const demoted = await blockRaw(ctx, blockIndex);
		if (demoted.startsWith('#')) {
			throw new Error(
				`[${ctx.label}] the first Backspace did not demote the heading: ${JSON.stringify(demoted)}`
			);
		}
		await undoOnceTo(ctx, before, 'live heading demote');
	});
}

/** Enter inside the strong pair `content` sits in closes and reopens it, so both halves stand
 *  balanced — the split the other modes take byte-literally. */
export async function liveSplitInsideConstruct(
	ctx: SimContext,
	blockIndex: number,
	content: string
): Promise<void> {
	await inLiveMode(ctx, async () => {
		const { page, editor } = ctx;
		const before = await editor.bridge.getSource();
		const raw = await blockRaw(ctx, blockIndex);
		// Cut inside the opening WORD: a half that begins or ends with a space is not emphasis
		// at all (the flanking rule), so the rebalancer moves the space out and the halves the
		// assertion below names would never be the ones it wrote.
		const cut = 2;
		if (content.length < 4 || /\s/.test(content.slice(0, cut + 1))) {
			throw new Error(`[${ctx.label}] split content must open with a word of 3+ characters`);
		}
		await seatCaret(ctx, blockIndex, indexOfIn(ctx, raw, content) + cut);

		const hostsBefore = await page.evaluate(() => document.querySelectorAll('.block-host').length);
		await page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(hostsBefore + 1);

		const after = await editor.bridge.getSource();
		const opener = `**${content.slice(0, cut)}**`;
		const closer = `**${content.slice(cut)}**`;
		if (!after.includes(opener) || !after.includes(closer)) {
			throw new Error(
				`[${ctx.label}] the live split left an unbalanced construct.\n` +
					`EXPECTED both ${JSON.stringify(opener)} and ${JSON.stringify(closer)}\n` +
					`ACTUAL: ${JSON.stringify(after)}`
			);
		}
		await undoOnceTo(ctx, before, 'live split inside a construct');
	});
}

/**
 * A heading opener typed onto a fresh line: the `#` mints chrome standing over nothing, which
 * flips the block's kind, so that keystroke resyncs — and everything behind it is a plain append
 * the tracker predicts byte for byte, marker paint or none.
 */
export async function liveTypeHeadingOpener(
	ctx: SimContext,
	blockIndex: number,
	text: string
): Promise<void> {
	await typedOpener(ctx, blockIndex, async () => {
		await mintOpener(ctx, '#', 'heading');
		for (const ch of ` ${text}`) {
			await ctx.editor.typeSlowly(ch);
			await settleTypedSource(ctx, ctx.tracker.appendChar(ch));
		}
	});
}

/**
 * A fence opener typed onto a fresh line, with its info string. The mint seats the caret on the
 * fence line ahead of the closer it opens, which the tracker's document-end model cannot predict,
 * so the info string settles on the line it forms and resyncs.
 */
export async function liveTypeFenceOpener(
	ctx: SimContext,
	blockIndex: number,
	info: string
): Promise<void> {
	await typedOpener(ctx, blockIndex, async () => {
		await mintOpener(ctx, '```', 'fencedCode');
		await ctx.editor.typeSlowly(info);
		await ctx.editor.bridge.waitForSourceContains('```' + info);
		await ctx.editor.waitForRenderFlush();
		ctx.tracker.resync(await ctx.editor.bridge.getSource());
	});
}

/**
 * A table header row typed onto a fresh line, completed by Enter. No keystroke in the row mints
 * anything, so the tracker predicts every byte of it; the Enter is the mint, and the only resync.
 */
export async function liveTypeTableOpener(
	ctx: SimContext,
	blockIndex: number,
	cells: string[]
): Promise<void> {
	await typedOpener(ctx, blockIndex, async () => {
		for (const ch of `| ${cells.join(' | ')} |`) {
			await ctx.editor.typeSlowly(ch);
			await settleTypedSource(ctx, ctx.tracker.appendChar(ch));
		}
		const before = await ctx.editor.bridge.getSource();
		await ctx.page.keyboard.press('Enter');
		await ctx.editor.bridge.waitForSourceWith((source, prev) => source !== prev, before);
		await settleMint(ctx, 'table', 'completing a header row');
	});
}

/** A merge landing rides the caret funnel: Backspace at a block's start joins it into its
 *  predecessor, the door seats the join offset, and the next byte lands at the seam (G2.12).
 *  `seamBefore`/`seamAfter` are the bytes the caller knows stand on either side of it. */
export async function liveMergeLanding(
	ctx: SimContext,
	blockIndex: number,
	seamBefore: string,
	seamAfter: string
): Promise<void> {
	await inLiveMode(ctx, async () => {
		const { page, editor } = ctx;
		const before = await editor.bridge.getSource();
		await seatCaret(ctx, blockIndex, 0);
		const hostsBefore = await page.evaluate(() => document.querySelectorAll('.block-host').length);
		await page.keyboard.press('Backspace');
		await editor.waitForBlockHostCount(hostsBefore - 1);
		const merged = await editor.bridge.getSource();

		await editor.typeSlowly('Q');
		const probe = `${seamBefore}Q${seamAfter}`;
		await editor.bridge.waitForSourceContains(probe);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(merged, 3000);
		await editor.undo();
		await editor.bridge.waitForSourceEquals(before, 3000);
	});
}

/** Home in a list item routes through the sentinel door — the ambient arm's raw-0 DOM write
 *  was the bypass (GH #110) — so the caret seats at the item's landable start and the next
 *  byte opens the line. `itemText` must start the item's content. */
export async function liveListHomeSeat(ctx: SimContext, itemText: string): Promise<void> {
	await inLiveMode(ctx, async () => {
		const { page, editor } = ctx;
		const before = await editor.bridge.getSource();
		await clickText(ctx, itemText.split(' ')[0]);
		await page.keyboard.press('End');
		await editor.waitForRenderFlush();
		await page.keyboard.press('Home');
		await editor.waitForRenderFlush();
		const at = await caretOffset(ctx);
		if (at !== 0) {
			throw new Error(`[${ctx.label}] Home in the list item seated at ${at}, not the start`);
		}

		await editor.typeSlowly('Q');
		await editor.bridge.waitForSourceContains(`Q${itemText}`);
		await undoOnceTo(ctx, before, 'live list-item Home seat');
	});
}

/** The cross-block extend's cell arm: extending into a table reveals the endpoint cell and
 *  parks the START sentinel in it (G2.12). Byte-free — the extend and its collapse move
 *  nothing, which is itself the assertion. */
export async function liveExtendIntoTablePark(ctx: SimContext): Promise<void> {
	await inLiveMode(ctx, async () => {
		const { page, editor } = ctx;
		const before = await editor.bridge.getSource();
		const { proseIndex, tableIndex } = await proseAboveTable(ctx);
		await editor.clickBlock(proseIndex);
		await page.keyboard.press('End');
		await editor.waitForRenderFlush();

		let entered = false;
		for (let i = 0; i < 3 && !entered; i++) {
			await page.keyboard.press('Shift+ArrowDown');
			await editor.waitForRenderFlush();
			entered = (await editor.bridge.getSelectionPaths())?.focus.path[0] === tableIndex;
		}
		if (!entered || !(await editor.bridge.isCrossBlockActive())) {
			throw new Error(`[${ctx.label}] the extend never reached the table's cell endpoint`);
		}

		await page.keyboard.press('Escape');
		await editor.waitForRenderFlush();
		const after = await editor.bridge.getSource();
		if (after !== before) {
			throw new Error(
				`[${ctx.label}] the extend-and-collapse moved bytes.\n` +
					`BEFORE: ${JSON.stringify(before)}\nAFTER:  ${JSON.stringify(after)}`
			);
		}
	});
}

/** The first table block and the prose leaf directly above it, or a loud miss. */
async function proseAboveTable(
	ctx: SimContext
): Promise<{ proseIndex: number; tableIndex: number }> {
	const found = await ctx.page.evaluate(() => {
		const children = (window as any).__test.getDocument().children as { kind: string }[];
		const tableIndex = children.findIndex((c) => c.kind === 'table');
		const above = children[tableIndex - 1]?.kind;
		return { tableIndex, above };
	});
	if (found.tableIndex < 1 || !['paragraph', 'heading'].includes(found.above ?? '')) {
		throw new Error(`[${ctx.label}] no prose leaf directly above a table to extend from`);
	}
	return { proseIndex: found.tableIndex - 1, tableIndex: found.tableIndex };
}

/** A click on a rendered link opens the card — the only surface live gives a destination — and
 *  Enter in its field rewrites those bytes as one entry. */
export async function liveLinkCardEdit(
	ctx: SimContext,
	linkText: string,
	url: string
): Promise<void> {
	await inLiveMode(ctx, async () => {
		const { page, editor } = ctx;
		const before = await editor.bridge.getSource();

		await clickText(ctx, linkText);
		await page.locator(CARD).waitFor({ state: 'visible', timeout: 2000 });
		const field = page.locator(`${CARD} input`);
		await field.click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type(url);
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains(url);

		await undoOnceTo(ctx, before, 'live link-card commit');
	});
}

// ── Internal ────────────────────────────────────────────────────────────────

/**
 * The envelope both typed openers share: a fresh empty line below `blockIndex` to type onto, and
 * an unwind by the entries the run actually spent — a typed run batches on wall-clock time, so
 * the press count is measured rather than assumed, and `inLiveMode` asserts the bytes came back.
 */
async function typedOpener(
	ctx: SimContext,
	blockIndex: number,
	run: () => Promise<void>
): Promise<void> {
	await inLiveMode(ctx, async () => {
		const { page, editor, tracker } = ctx;
		const depth = await undoStackDepth(ctx);
		await editor.clickBlock(blockIndex);
		await page.keyboard.press('End');
		await editor.waitForRenderFlush();
		const hosts = await page.evaluate(() => document.querySelectorAll('.block-host').length);
		await page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(hosts + 1);
		tracker.resync(await editor.bridge.getSource());

		await run();

		for (let spent = (await undoStackDepth(ctx)) - depth; spent > 0; spent--) {
			await editor.undo();
			await editor.waitForRenderFlush();
		}
	});
}

/** The keystrokes that mint a block's own chrome. */
async function mintOpener(ctx: SimContext, opener: string, kind: string): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await ctx.editor.typeSlowly(opener);
	await ctx.editor.bridge.waitForSourceWith((source, prev) => source !== prev, before);
	await settleMint(ctx, kind, `typing ${JSON.stringify(opener)}`);
}

/** The tail every mint shares: the kind flip is auto-behavior, so this settles on it, asserts the
 *  flip the keystroke just paid for, and resyncs instead of predicting. */
async function settleMint(ctx: SimContext, kind: string, what: string): Promise<void> {
	const { editor, tracker } = ctx;
	await editor.waitForRenderFlush();
	const at = (await editor.bridge.getSelectionPaths())?.focus.path[0] ?? -1;
	const minted = at < 0 ? null : await editor.bridge.getBlockKind(at);
	if (minted !== kind) {
		throw new Error(
			`[${ctx.label}] ${what} minted ${minted}, not ${kind}.\n` +
				`SOURCE: ${JSON.stringify(await editor.bridge.getSource())}`
		);
	}
	tracker.resync(await editor.bridge.getSource());
}

/** The § 5 contract every gesture here closes on: the rule wrote ONE undo entry, so one press
 *  is both the assertion and the return to identity. */
async function undoOnceTo(ctx: SimContext, before: string, what: string): Promise<void> {
	await ctx.editor.undo();
	try {
		await ctx.editor.bridge.waitForSourceEquals(before, 3000);
	} catch {
		throw new Error(
			`[${ctx.label}] ${what}: one undo did not restore the bytes.\n` +
				`EXPECTED: ${JSON.stringify(before)}\n` +
				`ACTUAL:   ${JSON.stringify(await ctx.editor.bridge.getSource())}`
		);
	}
}

async function blockRaw(ctx: SimContext, blockIndex: number): Promise<string> {
	const raw = await ctx.page.evaluate(
		(i) => (window as any).__test.getDocument().children[i]?.raw ?? null,
		blockIndex
	);
	if (typeof raw !== 'string') throw new Error(`[${ctx.label}] no block at index ${blockIndex}`);
	return raw;
}

function indexOfIn(ctx: SimContext, raw: string, needle: string): number {
	const at = raw.indexOf(needle);
	if (at < 0) throw new Error(`[${ctx.label}] ${JSON.stringify(needle)} not in ${raw}`);
	return at;
}

async function caretOffset(ctx: SimContext): Promise<number> {
	return (await ctx.editor.bridge.getSelectionPaths())?.focus.offset ?? -1;
}

/**
 * A real click lands the caret near the target, then arrows walk it exactly onto it: in live
 * a hidden run has no box, so the click's pixel→offset mapping is approximate by construction
 * while the arrow walk is the caret contract itself.
 */
async function seatCaret(ctx: SimContext, blockIndex: number, offset: number): Promise<void> {
	await ctx.editor.clickBlockAtPath([blockIndex], offset);
	for (let i = 0; i < 24; i++) {
		const at = await caretOffset(ctx);
		if (at === offset) return;
		await ctx.page.keyboard.press(at < offset ? 'ArrowRight' : 'ArrowLeft');
		await ctx.editor.waitForRenderFlush();
	}
	throw new Error(
		`[${ctx.label}] could not seat the caret at ${offset} in block ${blockIndex} ` +
			`(stopped at ${await caretOffset(ctx)})`
	);
}

/** Seat at the word's first byte, then Shift+ArrowRight over it — every byte of a plain word
 *  is painted, so one press per character is exact. */
async function selectWord(ctx: SimContext, blockIndex: number, word: string): Promise<void> {
	const raw = await blockRaw(ctx, blockIndex);
	await seatCaret(ctx, blockIndex, indexOfIn(ctx, raw, word));
	for (let i = 0; i < word.length; i++) await ctx.page.keyboard.press('Shift+ArrowRight');
	await ctx.editor.waitForRenderFlush();
}

/** Click the middle of a rendered phrase. Text-node geometry, not a raw-offset walk: a hidden
 *  run measures to nothing, so an offset-derived pixel would miss. */
async function clickText(ctx: SimContext, phrase: string): Promise<void> {
	const point = await ctx.page.evaluate((needle) => {
		const root = document.querySelector('.editor')!;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const at = node.textContent?.indexOf(needle) ?? -1;
			if (at < 0) continue;
			const range = document.createRange();
			range.setStart(node, at);
			range.setEnd(node, at + needle.length);
			const rect = range.getBoundingClientRect();
			return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		}
		return null;
	}, phrase);
	if (!point) throw new Error(`[${ctx.label}] no rendered text matching ${JSON.stringify(phrase)}`);
	await ctx.page.mouse.click(point.x, point.y);
	await ctx.editor.waitForRenderFlush();
}
