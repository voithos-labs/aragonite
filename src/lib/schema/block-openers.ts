/**
 * Per-kind block-opener registry: the parser's dispatch order and the paragraph-interrupt scan
 * both come from these declarations, so registering an opener puts it in both. Paragraph is the
 * fallback and has no opener; setext headings and tables come out of its continuation scan.
 */

import { isBuiltinBlockKind, type AnyBlockKind, type CstNode } from '../core/nodes';
import type { ParsedLine } from '../core/lines';
import {
	enqueueRegistrationCheck,
	hasPendingRegistrationChecks,
	markGrammarConsumed
} from './registration-pending';
import { flushPendingRegistrationChecks } from './registration-checks';
import { createBlockKindRegistry, type RegistryRecord } from './plugin-registry';
import { everyInstalledPlugin, resolvesIn, type PluginActivation } from './plugin-activation';
import { pluginInstallGeneration } from './plugin-install';

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
}

type OpenerRecord = RegistryRecord<AnyBlockKind, BlockOpener>;

let orderedRecordsCache: OpenerRecord[] | null = null;
let orderedCache: BlockOpener[] | null = null;
let interruptCache: { generation: number; predicates: ((lineText: string) => boolean)[] } | null =
	null;

const openers = createBlockKindRegistry<BlockOpener>({
	label: 'registerBlockOpener',
	isBuiltin: isBuiltinBlockKind,
	onChange: () => {
		orderedRecordsCache = null;
		orderedCache = null;
		interruptCache = null;
	}
});

export function registerBlockOpener(kind: AnyBlockKind, opener: BlockOpener): void {
	openers.register(
		kind,
		opener,
		`registerBlockOpener: "${kind}" is already registered. Openers are register-once.`
	);
	enqueueRegistrationCheck(kind, 'opener');
}

/**
 * Is an opener registered? `registerBlockOpener` throws on a duplicate, so a plugin that may
 * register twice (hot reload, re-import) checks this first. Takes a plain name.
 */
export function isBlockOpenerRegistered(kind: string): boolean {
	return openers.has(kind as AnyBlockKind);
}

/** A per-instance enablement predicate: `true` keeps the kind's opener in the grammar. */
export type OpenerEnablement = (kind: AnyBlockKind) => boolean;

// Priority-ascending, ties broken by kind name: dispatch order is a pure function of the
// declarations, never of registration order.
function orderedRecords(): readonly OpenerRecord[] {
	if (!orderedRecordsCache) {
		orderedRecordsCache = openers
			.records()
			.sort(
				(a, b) =>
					a.value.priority - b.value.priority || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
			);
	}
	return orderedRecordsCache;
}

/** Every registered opener in dispatch order, whoever registered it. An editor's own order is its
 *  `GrammarView.orderedOpeners`. */
export function getOrderedOpeners(): readonly BlockOpener[] {
	const records = consumedRecords();
	if (!orderedCache) orderedCache = records.map((r) => r.value);
	return orderedCache;
}

// Pending registrations are checked before the read and the grammar marked used only after it, so
// a registration racing the first read is not warned about as a late opener (G1.17).
function consumedRecords(): readonly OpenerRecord[] {
	if (hasPendingRegistrationChecks()) flushPendingRegistrationChecks();
	markGrammarConsumed();
	return orderedRecords();
}

/**
 * Global, not per editor, so an unlisted plugin's line still ends a paragraph; a plugin whose
 * setup threw interrupts nothing. The paragraph parser stops at `---` itself.
 */
export function lineInterruptsParagraph(lineText: string): boolean {
	const records = consumedRecords();
	const generation = pluginInstallGeneration();
	if (interruptCache?.generation !== generation) {
		interruptCache = {
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

/** Read by the dev-mode check that warns when two kinds share a priority (G1.10). */
export function listRegisteredOpeners(): { kind: AnyBlockKind; priority: number }[] {
	return openers.records().map((r) => ({ kind: r.key, priority: r.value.priority }));
}
