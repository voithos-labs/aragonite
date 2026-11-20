/**
 * The block grammar read off the kind registrations' openers: the parser's dispatch order and the
 * paragraph-interrupt scan both come from them. Paragraph is the fallback and has no opener;
 * setext headings and tables come out of its continuation scan.
 */

import type { AnyBlockKind, CstNode } from '../core/nodes';
import type { ParsedLine } from '../core/lines';
import { hasPendingRegistrationChecks, markGrammarConsumed } from './registration-pending';
import { flushPendingRegistrationChecks } from './registration-checks';
import type { RegistryRecord } from './plugin-registry';
import type { PluginActivation } from './plugin-activation';
import { onBlockKindChange, openerRecords } from './block-kind-descriptor';
import { registerBuiltInDescriptors } from './built-in-descriptors';
import type { BlockCompleter } from './block-completions';
import type { MarkedLines } from '../core/strip-lines';

/** Created fresh for each block and read synchronously; never keep it past the call. */
export interface OpenContext {
	lines: ParsedLine[];
	index: number;
	end: number;
	/** The line at `index`, precomputed once per dispatch. */
	line: ParsedLine;
	/** The blank lines above this block, which the paragraph-interrupt rules read (GFM §4.4);
	 *  non-empty means a blank line precedes it. */
	leadingTrivia: string;
	/** True when the parse was given a whole document, false for one block's bytes alone. It holds
	 *  through nested parses, so a position check also reads `index` and `depth`. */
	isDocumentParse: boolean;
	/** Container nesting depth, 0 at the root. A container opener parses its body at `depth + 1`;
	 *  past `MAX_NESTING_DEPTH` deeper input becomes paragraph content. */
	depth: number;
	/** The editor's grammar. A container opener hands it to its body parse, so a kind this
	 *  editor switched off stays off inside a list item or a quote too. */
	grammar: GrammarView;
}

/**
 * What an opener returns for the lines starting at `ctx.index`. `consumed` is a line count, not
 * a resume position, and must be at least 1: taking no line would spin the parse loop, so the
 * parser rejects that result.
 */
export interface BlockOpenerResult {
	node: CstNode;
	consumed: number;
}

export interface BlockOpener {
	priority: number;
	/** Attempt to open this kind at ctx.index; null declines. */
	tryOpen(ctx: OpenContext): BlockOpenerResult | null;
	/** Whether a line of this kind interrupts an open paragraph (GFM continuation rules); `false` = never. */
	interruptsParagraph: ((lineText: string) => boolean) | false;
	/** For an opener whose reading a line below can still change (a lone `$$` backs out to a
	 *  paragraph, an open fence takes in what follows): which blocks, and which lines. Absent: none. */
	readingNotFinal?: UnfinishedReading;
}

/** The two halves of {@link BlockOpener.readingNotFinal}, declared together: a reading a line
 *  closes names that line, and one no line closes may say which lines its wait stops at. */
export type UnfinishedReading = ClosedReading | UnclosedReading;

interface ReadingNotFinal {
	/** Given a block's bytes from its first line on, read in the editor's grammar: my reading of
	 *  them isn't final, a line below could change it. Once final, it stays final with more lines. */
	notFinal: (raw: string, grammar: GrammarView) => boolean;
}

export interface ClosedReading extends ReadingNotFinal {
	/** Whether a line could be the one that changes it. A cheap candidate test, not a match: true
	 *  for every line this opener accepts as its closer, wider is fine, narrower breaks the edit. */
	mayClose: (lineText: string) => boolean;
	/** The line that closes a waiting block whose bytes are `raw`, which an opener typed on its own
	 *  line is given so it takes in no block below it. */
	closer: (raw: string) => string;
	/** The block takes in every line below it until its closer, as an unclosed fence does: it never
	 *  stands above another block, and with no closer below it reads to the body's end. */
	readsOn?: boolean;
}

/** A reading no line closes, as a link definition waits on a title: `notFinal` is also asked of a
 *  block's bytes together with the blocks under it, and a blank line always ends the wait. Both
 *  answers must follow from the bytes asked about alone, since the editor keeps them. */
export interface UnclosedReading extends ReadingNotFinal {
	closer: null;
	/** Whether the wait runs on across a block under the waiting one that opens with this line.
	 *  Absent: across every line, to the blank line. */
	crosses?: (lineText: string, grammar: GrammarView) => boolean;
}

/** A reading as one grammar hands it out, which reads a block's bytes in that grammar. */
export type GrammarReading = ClosedInGrammar | UnclosedInGrammar;

export type ClosedInGrammar = Omit<ClosedReading, 'notFinal'> & { notFinal(raw: string): boolean };

export type UnclosedInGrammar = Omit<UnclosedReading, 'notFinal' | 'crosses'> & {
	notFinal(raw: string): boolean;
	crosses?(lineText: string): boolean;
};

/** The readings a line closes, which alone say `mayClose` and `readsOn`. */
export const closed = (readings: readonly GrammarReading[]): ClosedInGrammar[] =>
	readings.filter((reading): reading is ClosedInGrammar => reading.closer !== null);

export type OpenerRecord = RegistryRecord<AnyBlockKind, BlockOpener>;

// A registration change drops the ordering; each editor's grammar keeps the list it was built from.
let orderedRecordsCache: OpenerRecord[] | null = null;

type Ordered = Pick<OpenerRecord, 'key' | 'value'>;

/** Dispatch order: priority-ascending, ties broken by kind name, so it is a pure function of the
 *  declarations, never of registration order. */
export function byOpenerOrder(a: Ordered, b: Ordered): number {
	return a.value.priority - b.value.priority || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

function orderedRecords(): readonly OpenerRecord[] {
	orderedRecordsCache ??= openerRecords().sort(byOpenerOrder);
	return orderedRecordsCache;
}

let builtInsRegistered = false;

/** Every opener record in dispatch order, for an editor's grammar to filter by its own list; the
 *  first call registers the built-ins, whichever module loaded first (G4.197). */
export function grammarRecords(): readonly OpenerRecord[] {
	if (!builtInsRegistered) registerBuiltIns();
	// Checked before the read and marked used after it, so a registration racing the first read
	// isn't warned about as late (G1.17).
	if (hasPendingRegistrationChecks()) flushPendingRegistrationChecks();
	markGrammarConsumed();
	return orderedRecords();
}

function registerBuiltIns(): void {
	builtInsRegistered = true;
	// Subscribed here rather than at load, since this module sits on the parser's import loop.
	onBlockKindChange(() => (orderedRecordsCache = null));
	registerBuiltInDescriptors();
}

// Kept against the grammar's opener list, which a walk up a long body reads once per block.
const readingsByOpeners = new WeakMap<readonly BlockOpener[], GrammarReading[]>();

/** Every opener's declaration of a reading a line below can still change, each listed once and
 *  reading a block's bytes in `grammar`. */
export function unfinishedReadings(grammar: GrammarView): readonly GrammarReading[] {
	const openers = grammar.orderedOpeners();
	let readings = readingsByOpeners.get(openers);
	if (!readings) {
		// Kinds sharing one grammar (every fence) share one reading, asked once.
		readings = [...new Set(openers.flatMap((opener) => opener.readingNotFinal ?? []))].map(
			(reading) => inGrammar(reading, grammar)
		);
		readingsByOpeners.set(openers, readings);
	}
	return readings;
}

function inGrammar(reading: UnfinishedReading, grammar: GrammarView): GrammarReading {
	const notFinal = (raw: string): boolean => reading.notFinal(raw, grammar);
	if (reading.closer !== null) return { ...reading, notFinal };
	const { crosses } = reading;
	return { ...reading, notFinal, crosses: crosses && ((line: string) => crosses(line, grammar)) };
}

/** The reading under which a block of these bytes waits on a line below that closes it, or null.
 *  A wait no line closes is {@link waitingAboveThrough}'s to find. */
export function waitingReading(
	raw: string,
	readings: readonly GrammarReading[]
): ClosedInGrammar | null {
	return closed(readings).find((reading) => reading.notFinal(raw)) ?? null;
}

/** The topmost of the `count` blocks above that a line of `written` closes by the same reading, the
 *  block a closer typed below finishes, so that line opens nothing; -1 when there is none. */
export function waitingAboveClosedBy(
	written: readonly string[],
	rawAbove: (index: number) => string,
	count: number,
	readings: readonly GrammarReading[]
): number {
	const closing = closed(readings).filter(
		(reading) => !reading.readsOn && written.some((line) => reading.mayClose(line))
	);
	if (closing.length === 0) return -1;
	let top = -1;
	for (let i = count - 1; i >= 0; i--) {
		if (closing.some((reading) => reading.notFinal(rawAbove(i)))) top = i;
	}
	return top;
}

/** A block's bytes and the blank lines above it, all the look for a wait reads of it. */
interface Held {
	readonly raw: string;
	readonly leadingTrivia: string;
}

const unclosed = (readings: readonly GrammarReading[]): UnclosedInGrammar[] =>
	readings.filter((reading): reading is UnclosedInGrammar => reading.closer === null);

/** Whether a wait under `reading` runs on into `below`, the block right under the waiting one. */
function reaches(reading: UnclosedInGrammar, below: Held): boolean {
	if (below.leadingTrivia !== '') return false;
	const end = below.raw.indexOf('\n');
	const line = (end < 0 ? below.raw : below.raw.slice(0, end)).replace(/\r$/, '');
	return reading.crosses?.(line) ?? true;
}

/** The highest block above `from` that a reading no line closes leaves waiting past `from`'s end:
 *  read from its first line down to there, a line below could still change it. -1 when none. */
export function waitingAboveThrough(
	block: (index: number) => Held,
	from: number,
	floor: number,
	readings: readonly GrammarReading[]
): number {
	return waitingPast(block, from, floor, unclosed(readings));
}

/** The highest block above `at` whose wait, under a reading no line closes, is still open where
 *  block `at` starts and runs on into it, so a line of `at` could still change it. -1 when none. */
export function waitingInto(
	block: (index: number) => Held,
	at: number,
	floor: number,
	readings: readonly GrammarReading[]
): number {
	if (at <= floor) return -1;
	const live = unclosed(readings).filter((reading) => reaches(reading, block(at)));
	if (live.length === 0) return -1;
	const above = waitingPast(block, at - 1, floor, live);
	if (above >= 0) return above;
	return live.some((reading) => reading.notFinal(block(at - 1).raw)) ? at - 1 : -1;
}

/** What a block answered with the first line of the block under it, kept on that lower block. */
interface FirstAsk {
	above: string;
	raw: string;
	leadingTrivia: string;
	live: UnclosedInGrammar[];
	reached: UnclosedInGrammar[];
	waiting: UnclosedInGrammar[];
}

const firstAsks = new WeakMap<Held, FirstAsk>();

// A walk up a long run asks each pair once while both blocks hold the bytes and blank lines they
// did and the same readings ask: a reading is bound to one opener list, interrupts and all.
function firstAsk(
	above: string,
	node: Held,
	raw: string,
	leadingTrivia: string,
	live: UnclosedInGrammar[]
): FirstAsk {
	const kept = firstAsks.get(node);
	if (
		kept?.above === above &&
		kept.raw === raw &&
		kept.leadingTrivia === leadingTrivia &&
		askedBy(kept, live)
	)
		return kept;
	const below = { raw, leadingTrivia };
	const reached = live.filter((reading) => reaches(reading, below));
	const line = raw.slice(0, raw.indexOf('\n') + 1 || raw.length);
	const waiting = reached.filter((reading) => reading.notFinal(above + line));
	const asked = { above, raw, leadingTrivia, live, reached, waiting };
	firstAsks.set(node, asked);
	return asked;
}

/** Whether these readings asked `kept`. It keeps the list it matched, which a walk hands it again. */
function askedBy(kept: FirstAsk, live: UnclosedInGrammar[]): boolean {
	if (kept.live === live) return true;
	if (kept.live.length !== live.length || kept.live.some((reading, k) => reading !== live[k]))
		return false;
	kept.live = live;
	return true;
}

function waitingPast(
	block: (index: number) => Held,
	from: number,
	floor: number,
	live: UnclosedInGrammar[]
): number {
	if (from <= floor || live.length === 0) return -1;
	let top = -1;
	// One read of a block's bytes a walk, a pair's upper block being the next pair's lower: over the
	// editor's tree each read goes through a proxy, and a long run pays for every one.
	let below = block(from);
	let raw = below.raw;
	for (let i = from; i > floor && live.length > 0; i--) {
		const above = block(i - 1);
		const aboveRaw = above.raw;
		const first = firstAsk(aboveRaw, below, raw, below.leadingTrivia, live);
		live = first.reached;
		let bytes = aboveRaw;
		// Asked with the next line alone, then with twice the blocks each time: a block a few lines
		// settle stays settled with more under them, so it is never handed the whole run.
		let waiting = first.waiting;
		for (let k = i, step = 1; k <= from && waiting.length > 0; step *= 2) {
			for (const end = Math.min(from, k + step - 1); k <= end; k++) bytes += block(k).raw;
			waiting = waiting.filter((reading) => reading.notFinal(bytes));
		}
		if (waiting.length > 0) top = i - 1;
		below = above;
		raw = aboveRaw;
	}
	return top;
}

/** Where a read has to run on to: the last block from `from` that a wait still open past the end
 *  of `read` can reach, or -1 when no block of `read` still waits there. */
export function waitRunsPast(
	read: readonly Held[],
	block: (index: number) => Held,
	from: number,
	last: number,
	readings: readonly GrammarReading[]
): number {
	if (waitingAboveThrough((i) => read[i], read.length - 1, 0, readings) < 0) return -1;
	const live = unclosed(readings);
	let to = from;
	while (to < last && live.some((reading) => reaches(reading, block(to + 1)))) to++;
	return to;
}

/**
 * The grammar a parse reads, passed as `parse(source, { grammar })` and to the inline scan: one
 * editor's, built by `editor-grammar.ts` from the built-ins and that editor's plugin list.
 */
export interface GrammarView {
	orderedOpeners(): readonly BlockOpener[];
	/** Whether `lineText` cuts an open paragraph short (GFM continuation rules) in this grammar. */
	interruptsParagraph(lineText: string): boolean;
	/** Whether a `===` or `---` line under paragraph text makes it a heading. */
	readonly setextHeading: boolean;
	/** The plugins this editor turned on; every plugin-registered entry resolves through it. */
	readonly activation: PluginActivation;
	/** The completers of the block types this editor's plugins contribute. */
	completers?(): readonly BlockCompleter[];
	/** The line shapes of the containers this grammar opens that mark every line (a quote's `>`),
	 *  each once: what the range core reads a line's markers through. */
	markedLines(): readonly MarkedLines[];
}

// ── Outer block starts ──────────────────────────────────────────────────

/** What a line means at the outer level, which turns on whether a paragraph is open above it. */
export interface OuterBlockScan {
	/** A lazy continuation: an open paragraph absorbs the block starts §4.4 forbids from interrupting. */
	paragraphOpen: boolean;
	/** The editor's grammar: an opener it left out starts no block here. */
	grammar: GrammarView;
	/** The lines `line` sits in (`lines[index]` is `line`), so an opener that needs a later line to
	 *  open, a `$$` block and its closing line, sees it. Without them `line` is read alone. */
	window?: { lines: ParsedLine[]; index: number; end: number };
}

/**
 * Whether `line` starts a block at the outer level, where cmark-gfm ends a lazy continuation or a
 * table. A link reference definition never counts, nor indented code under an open paragraph.
 */
export function lineStartsOuterBlock(line: ParsedLine, scan: OuterBlockScan): boolean {
	const { grammar } = scan;
	const probe: OpenContext = {
		...(scan.window ?? { lines: [line], index: 0, end: 1 }),
		line,
		leadingTrivia: '',
		isDocumentParse: false,
		// Always 0 on purpose: the question is which kind opens at the outer level, and depth only
		// moves the nesting cap and the body parse below, never which kind opens.
		depth: 0,
		grammar
	};
	for (const opener of grammar.orderedOpeners()) {
		const claim = opener.tryOpen(probe);
		if (claim) return claimOpensBlock(claim.node.kind, scan.paragraphOpen);
	}
	return false;
}

function claimOpensBlock(kind: AnyBlockKind, paragraphOpen: boolean): boolean {
	if (kind === 'linkReferenceDefinition') return false;
	return !(paragraphOpen && kind === 'indentedCode');
}
