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

/** The two halves of {@link BlockOpener.readingNotFinal}, declared together. */
export interface UnfinishedReading {
	/** Given a block's own bytes, read in the editor's grammar: my reading of them isn't final, a
	 *  line below could change it. */
	notFinal: (raw: string, grammar: GrammarView) => boolean;
	/** Whether a line could be the one that changes it. A cheap candidate test, not a match: true
	 *  for every line this opener accepts as its closer, wider is fine, narrower breaks the edit. */
	mayClose: (lineText: string) => boolean;
	/** The line that closes a waiting block whose bytes are `raw`, which an opener typed on its own
	 *  line is given so it takes in no block below it; null where no line closes it. */
	closer: ((raw: string) => string) | null;
	/** The block takes in every line below it until its closer, as an unclosed fence does: it never
	 *  stands above another block, and with no closer below it reads to the body's end. */
	readsOn?: boolean;
}

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
			(reading) => ({ ...reading, notFinal: (raw: string) => reading.notFinal(raw, grammar) })
		);
		readingsByOpeners.set(openers, readings);
	}
	return readings;
}

/** A reading as one grammar hands it out, which reads a block's bytes in that grammar. */
export type GrammarReading = Omit<UnfinishedReading, 'notFinal'> & {
	notFinal(raw: string): boolean;
};

/** The reading under which a block of these bytes waits on a line below that closes it, or null:
 *  a reading with no closing line (a link definition's) never takes in the blocks below. */
export function waitingReading(
	raw: string,
	readings: readonly GrammarReading[]
): GrammarReading | null {
	return readings.find((reading) => reading.closer !== null && reading.notFinal(raw)) ?? null;
}

/** The topmost of the `count` blocks above that a line of `written` closes by the same reading, the
 *  block a closer typed below finishes, so that line opens nothing; -1 when there is none. */
export function waitingAboveClosedBy(
	written: readonly string[],
	rawAbove: (index: number) => string,
	count: number,
	readings: readonly GrammarReading[]
): number {
	const closing = readings.filter(
		(reading) => !reading.readsOn && written.some((line) => reading.mayClose(line))
	);
	if (closing.length === 0) return -1;
	let top = -1;
	for (let i = count - 1; i >= 0; i--) {
		if (closing.some((reading) => reading.notFinal(rawAbove(i)))) top = i;
	}
	return top;
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
