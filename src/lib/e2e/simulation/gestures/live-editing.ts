import { settleTypedSource, undoStackDepth, type SimContext } from '../invariants';

/**
 * Live-mode editing gestures. Each switches into live mode through the header toggle, drives one
 * live-only rule with real keys, and undoes it, in the one press the rule is meant to cost or by
 * however many entries the typing spent, so the bytes end up as they were and a note can run it
 * mid-session. The source is the only thing to check against: live mode shows no delimiters, so
 * the bytes are the one witness that the rule fired on text the user never saw.
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

/** Switch into live mode, run, switch back. The toggle is a real click both ways, and the source
 *  must come back byte for byte the same, whatever the rule in between did. */
async function inLiveMode(ctx: SimContext, run: () => Promise<void>): Promise<void> {
	const { page, editor, tracker } = ctx;
	// Gives this gesture's edit its own undo entry, so the single undo it closes with reverses
	// exactly that rather than reaching back into whatever was typed before.
	await editor.waitForUndoBatchFlush();
	const before = await editor.bridge.getSource();
	const toggle = page.getByTestId('live-toggle');

	await toggle.click();
	await page.waitForSelector('.editor[data-presentation="live"]', { timeout: 5000 });
	try {
		await run();
	} finally {
		await toggle.click();
		await page.waitForSelector('.editor:not([data-presentation])', { timeout: 5000 });
	}
	await editor.bridge.waitForSourceEquals(before, 3000);
	tracker.resync(before);
}

// ── Gestures ────────────────────────────────────────────────────────────────

/** Select `word` and toggle a mark over it: the bytes are written at once, as their own undo
 *  entry. The same shortcut with no selection waits instead and writes nothing. */
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

/** Backspace at the end of a construct's text takes the character the user sees, never the
 *  delimiter behind it, which is the byte the browser's own editing would have taken. */
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
				`[${ctx.label}] live edge Backspace did not take the last content character.
` +
					`EXPECTED ${JSON.stringify(content)} to become ${JSON.stringify(shortened)}
` +
					`ACTUAL: ${JSON.stringify(after)}`
			);
		}
		await undoOnceTo(ctx, before, 'live edge Backspace');
	});
}

/** Backspace at the start of a heading's text drops the `# ` prefix, which live mode does not
 *  show, before merging anything: demoting comes first, and only where the prefix is hidden. */
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

/** Enter inside the `**` pair that `content` sits in closes it and opens it again, so both
 *  halves are balanced; the other modes split the line byte for byte instead. */
export async function liveSplitInsideConstruct(
	ctx: SimContext,
	blockIndex: number,
	content: string
): Promise<void> {
	await inLiveMode(ctx, async () => {
		const { page, editor } = ctx;
		const before = await editor.bridge.getSource();
		const raw = await blockRaw(ctx, blockIndex);
		// Cut inside the first word: a half that starts or ends with a space is not emphasis at
		// all, so the editor moves the space out and the halves checked below would not be the
		// ones it wrote.
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
 * A heading opener typed onto a new line: the `#` creates a marker with nothing under it, which
 * changes the block's kind, so that keystroke resyncs. Everything after it is plain text added
 * at the end, which the expected answer predicts byte for byte, shown marker or not.
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
 * A fence opener typed onto a new line, with its info string. Creating the block puts the caret
 * on the fence line in front of the closing line it opens, which the expected answer cannot
 * predict, so the info string waits for the line it forms and resyncs.
 */
export async function liveTypeFenceOpener(
	ctx: SimContext,
	blockIndex: number,
	info: string
): Promise<void> {
	await typedOpener(ctx, blockIndex, async () => {
		const before = await ctx.editor.bridge.getSource();
		await ctx.editor.typeSlowly('```');
		await ctx.editor.bridge.waitForSourceWith((source, prev) => source !== prev, before);
		// The completed fence opens its language picker, which keeps the keys until Enter writes
		// the info string and puts the caret back in the body.
		await ctx.page.locator('.code-lang-picker input').waitFor({ state: 'visible' });
		await ctx.page.keyboard.type(info);
		await ctx.page.keyboard.press('Enter');
		await ctx.editor.bridge.waitForSourceContains('```' + info);
		await settleMint(ctx, 'fencedCode', 'typing "```"');
		ctx.tracker.resync(await ctx.editor.bridge.getSource());
	});
}

/**
 * A table header row typed onto a new line, completed by Enter. No keystroke in the row creates
 * anything, so every byte of it is predicted; the Enter builds the table, and is the one resync.
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

/** Backspace at a block's start joins it into the block above, and the editor puts the caret at
 *  the join, where the next typed byte lands (G2.12). `seamBefore` and `seamAfter` are the bytes
 *  the caller knows stand on either side of that join. */
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

/** Home in a list item goes through the editor's own caret placement, so the caret lands at the
 *  first offset the item allows and the next byte opens the line. `itemText` must be the start
 *  of the item's content. */
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
			throw new Error(`[${ctx.label}] Home in the list item placed at ${at}, not the start`);
		}

		await editor.typeSlowly('Q');
		await editor.bridge.waitForSourceContains(`Q${itemText}`);
		await undoOnceTo(ctx, before, 'live list-item Home seat');
	});
}

/** Extending a selection into a table opens the cell the selection ends in and puts the caret
 *  there (G2.12). No bytes move: the extend and its collapse change nothing, which is what this
 *  checks. */
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

/** The first table and the prose block directly above it, or a loud failure. */
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

/** A click on a rendered link opens its card, the only way live mode shows a destination, and
 *  Enter in the field rewrites those bytes as one undo entry. */
export async function liveLinkCardEdit(
	ctx: SimContext,
	linkText: string,
	url: string
): Promise<void> {
	await inLiveMode(ctx, async () => {
		const { page, editor } = ctx;
		const before = await editor.bridge.getSource();

		await clickText(ctx, linkText);
		await page.locator(CARD).waitFor({ state: 'visible', timeout: 5000 });
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
 * What both typed openers share: a new empty line below `blockIndex` to type onto, and an undo
 * of however many entries the typing actually spent. Typing batches on elapsed time, so the
 * number of presses is measured rather than assumed, and `inLiveMode` checks the bytes returned.
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

/** The keystrokes that create a block's own markers. */
async function mintOpener(ctx: SimContext, opener: string, kind: string): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await ctx.editor.typeSlowly(opener);
	await ctx.editor.bridge.waitForSourceWith((source, prev) => source !== prev, before);
	await settleMint(ctx, kind, `typing ${JSON.stringify(opener)}`);
}

/** The ending every one of those shares: the change of kind is the editor's own, so this waits
 *  for it, checks the keystroke bought it, and resyncs instead of predicting. */
async function settleMint(ctx: SimContext, kind: string, what: string): Promise<void> {
	const { editor, tracker } = ctx;
	await editor.waitForRenderFlush();
	const at = (await editor.bridge.getSelectionPaths())?.focus.path[0] ?? -1;
	const minted = at < 0 ? null : await editor.bridge.getBlockKind(at);
	if (minted !== kind) {
		throw new Error(
			`[${ctx.label}] ${what} created ${minted}, not ${kind}.
` + `SOURCE: ${JSON.stringify(await editor.bridge.getSource())}`
		);
	}
	tracker.resync(await editor.bridge.getSource());
}

/** What every gesture here closes on (live-mode.md § 5): the rule wrote one undo entry, so one
 *  press both checks that and puts the bytes back. */
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
 * A real click puts the caret near the target and arrow presses walk it exactly onto it: in live
 * mode a hidden run of text has no box on screen, so turning a pixel into an offset can only be
 * approximate, while the arrow walk is the rule the caret is held to.
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
		`[${ctx.label}] could not put the caret at ${offset} in block ${blockIndex} ` +
			`(stopped at ${await caretOffset(ctx)})`
	);
}

/** Put the caret on the word's first byte, then Shift+ArrowRight across it: every byte of a
 *  plain word is on screen, so one press per character is exact. */
async function selectWord(ctx: SimContext, blockIndex: number, word: string): Promise<void> {
	const raw = await blockRaw(ctx, blockIndex);
	await seatCaret(ctx, blockIndex, indexOfIn(ctx, raw, word));
	for (let i = 0; i < word.length; i++) await ctx.page.keyboard.press('Shift+ArrowRight');
	await ctx.editor.waitForRenderFlush();
}

/** Click the middle of a rendered phrase, measured from the text node rather than worked out
 *  from a raw offset: a hidden run of text measures to nothing, so that pixel would miss. */
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
