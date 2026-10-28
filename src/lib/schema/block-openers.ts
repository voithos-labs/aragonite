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
import { everyInstalledPlugin, resolvesIn, type PluginActivation } from './plugin-activation';
import { pluginInstallGeneration } from './plugin-install';
import { onBlockKindChange, openerRecords } from './block-kind-descriptor';
import { registerBuiltInDescriptors } from './built-in-descriptors';

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
	/** Given a block's own bytes: my reading of them isn't final, a line below could change it. */
	notFinal: (raw: string) => boolean;
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

type OpenerRecord = RegistryRecord<AnyBlockKind, BlockOpener>;

// A registration change drops the ordering; the caches below hold the ordering they were built from.
let orderedRecordsCache: OpenerRecord[] | null = null;
let orderedCache: { records: readonly OpenerRecord[]; openers: BlockOpener[] } | null = null;
let interruptCache: {
	records: readonly OpenerRecord[];
	generation: number;
	predicates: ((lineText: string) => boolean)[];
} | null = null;

/** A per-instance enablement predicate: `true` keeps the kind's opener in the grammar. */
export type OpenerEnablement = (kind: AnyBlockKind) => boolean;

// Priority-ascending, ties broken by kind name: dispatch order is a pure function of the
// declarations, never of registration order.
function orderedRecords(): readonly OpenerRecord[] {
	orderedRecordsCache ??= openerRecords().sort(
		(a, b) => a.value.priority - b.value.priority || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
	);
	return orderedRecordsCache;
}

/** Every registered opener in dispatch order, whoever registered it. An editor's own order is its
 *  `GrammarView.orderedOpeners`. */
export function getOrderedOpeners(): readonly BlockOpener[] {
	const records = consumedRecords();
	if (orderedCache?.records !== records) {
		orderedCache = { records, openers: records.map((r) => r.value) };
	}
	return orderedCache.openers;
}

let builtInsRegistered = false;

// Pending registrations are checked before the read and the grammar marked used only after it, so
// a registration racing the first read is not warned about as a late opener (G1.17).
function consumedRecords(): readonly OpenerRecord[] {
	if (!builtInsRegistered) registerBuiltIns();
	if (hasPendingRegistrationChecks()) flushPendingRegistrationChecks();
	markGrammarConsumed();
	return orderedRecords();
}

// On the first read, whichever module loaded first (G4.197).
function registerBuiltIns(): void {
	builtInsRegistered = true;
	// Subscribed here rather than at load, since this module sits on the parser's import loop.
	onBlockKindChange(() => (orderedRecordsCache = null));
	registerBuiltInDescriptors();
}

/**
 * Global, not per editor, so an unlisted plugin's line still ends a paragraph; a plugin whose
 * setup threw interrupts nothing. The paragraph parser stops at `---` itself.
 */
export function lineInterruptsParagraph(lineText: string): boolean {
	const records = consumedRecords();
	const generation = pluginInstallGeneration();
	if (interruptCache?.records !== records || interruptCache.generation !== generation) {
		interruptCache = {
			records,
			generation,
			predicates: records
				.filter((r) => resolvesIn(everyInstalledPlugin, r.owner))
				.map((r) => r.value.interruptsParagraph)
				.filter((p): p is (lineText: string) => boolean => p !== false)
		};
	}
	for (const predicate of interruptCache.predicates) {
		if (predicate(lineText)) return true;
	}
	return false;
}

// Kept against the grammar's opener list, which a walk up a long body reads once per block.
const readingsByOpeners = new WeakMap<readonly BlockOpener[], UnfinishedReading[]>();

/** Every opener's declaration of a reading a line below can still change, each listed once. */
export function unfinishedReadings(grammar: GrammarView): readonly UnfinishedReading[] {
	const openers = grammar.orderedOpeners();
	let readings = readingsByOpeners.get(openers);
	if (!readings) {
		// Kinds sharing one grammar (every fence) share one reading, asked once.
		readings = [...new Set(openers.flatMap((opener) => opener.readingNotFinal ?? []))];
		readingsByOpeners.set(openers, readings);
	}
	return readings;
}

/** The reading that says a block of these bytes waits on a line below to close it, or null. */
export function waitingReading(raw: string, grammar: GrammarView): UnfinishedReading | null {
	return unfinishedReadings(grammar).find((reading) => reading.notFinal(raw)) ?? null;
}

/** The topmost of the `count` blocks above that a line of `written` closes by the same reading, the
 *  block a closer typed below finishes, so that line opens nothing; -1 when there is none. */
export function waitingAboveClosedBy(
	written: readonly string[],
	rawAbove: (index: number) => string,
	count: number,
	readings: readonly UnfinishedReading[]
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
 * A per-editor view of the global syntax, passed in as `parse(source, { grammar })` and to the
 * inline scan. The opener dispatch, the setext underline check and every plugin's inline syntax,
 * widgets, directive names and completers are resolved per editor; the paragraph-interrupt scan
 * uses the global grammar.
 */
export interface GrammarView {
	orderedOpeners(): readonly BlockOpener[];
	/** Whether a `===` or `---` line under paragraph text makes it a heading. */
	readonly setextHeading: boolean;
	/** The plugins this editor activated; every plugin-registered entry resolves through it. */
	readonly activation: PluginActivation;
}

export function createGrammarView(
	isEnabled: OpenerEnablement,
	options: { setextHeading?: boolean; activation?: PluginActivation } = {}
): GrammarView {
	const activation = options.activation ?? everyInstalledPlugin;
	// A reparse reads this once per block, so the filtered list is cached against the global
	// ordering array and the installed set: a registration or an install rebuilds the filter.
	let builtFrom: readonly OpenerRecord[] | null = null;
	let builtAt = -1;
	let filtered: readonly BlockOpener[] = [];
	return {
		setextHeading: options.setextHeading ?? true,
		activation,
		orderedOpeners() {
			const records = consumedRecords();
			const generation = pluginInstallGeneration();
			if (records !== builtFrom || generation !== builtAt) {
				builtFrom = records;
				builtAt = generation;
				filtered = records
					.filter((r) => resolvesIn(activation, r.owner) && isEnabled(r.key))
					.map((r) => r.value);
			}
			return filtered;
		}
	};
}

/** The grammar a `parse()` with no editor reads: every opener but a failed plugin's. */
export const defaultGrammarView: GrammarView = createGrammarView(() => true);

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
