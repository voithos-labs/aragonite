/**
 * Per-kind block-opener registry: the parser's dispatch order and the
 * paragraph-interrupt scan both derive from these declarations, so a kind
 * (built-in or plugin) that registers an opener is automatically in both —
 * a forgotten interrupt registration was a silent round-trip bug when the
 * scan was a hand-maintained list. Paragraph is the unregistered total
 * fallback; setext headings and tables emerge from its continuation scan,
 * not from openers.
 */

import { isBuiltinBlockKind, type AnyBlockKind, type CstNode } from '../core/nodes';
import type { ParsedLine } from '../core/lines';
import {
	enqueueRegistrationCheck,
	hasPendingRegistrationChecks,
	markGrammarConsumed,
	__resetRegistrationChecksForTests
} from './registration-pending';
import { flushPendingRegistrationChecks } from './registration-checks';
import { registerOnce } from './register-once';

/**
 * One instance is reused across the parse loop — openers must consume it
 * synchronously and never retain it.
 */
export interface OpenContext {
	lines: ParsedLine[];
	index: number;
	end: number;
	/** The line at `index`, precomputed once per dispatch. */
	line: ParsedLine;
	leadingTrivia: string;
	/** True for the first content block of a parse window. With `leadingTrivia`, the "preceded by blank" interrupt context (GFM §4.4). */
	isFirstInWindow: boolean;
}

export interface BlockOpener {
	priority: number;
	/** Attempt to open this kind at ctx.index; null declines. */
	tryOpen(ctx: OpenContext): { node: CstNode; nextIndex: number } | null;
	/** Whether a line of this kind interrupts an open paragraph (GFM continuation rules); `false` = never. */
	interruptsParagraph: ((lineText: string) => boolean) | false;
}

const openers = new Map<AnyBlockKind, BlockOpener>();
let orderedCache: BlockOpener[] | null = null;
let interruptCache: ((lineText: string) => boolean)[] | null = null;

export function registerBlockOpener(kind: AnyBlockKind, opener: BlockOpener): void {
	registerOnce(
		openers.has(kind),
		() => {
			openers.set(kind, opener);
			enqueueRegistrationCheck(kind, 'opener');
			orderedCache = null;
			interruptCache = null;
		},
		`registerBlockOpener: "${kind}" is already registered. Openers are register-once.`
	);
}

/**
 * Probe by name whether an opener is registered. `registerBlockOpener` throws on
 * duplicate, so a plugin registering idempotently (HMR / re-import) guards on
 * this. Accepts a plain name so callers needn't pre-brand an unminted kind.
 */
export function isBlockOpenerRegistered(kind: string): boolean {
	return openers.has(kind as AnyBlockKind);
}

/**
 * Priority-ascending, equal priorities broken by kind name — so dispatch order
 * is a pure function of the declarations, never of registration order (G1.10
 * still warns on the tie, since a shared priority is usually unintended).
 * Cached — the parser loops this per block. The grammar-consumption seam:
 * registrations pending since the last flush are validated before this read,
 * and flush-before-mark keeps a registrant racing the first read out of the
 * late-opener warn (G1.17).
 */
export function getOrderedOpeners(): readonly BlockOpener[] {
	if (hasPendingRegistrationChecks()) flushPendingRegistrationChecks();
	markGrammarConsumed();
	if (!orderedCache) {
		orderedCache = [...openers.entries()]
			.sort(
				([kindA, a], [kindB, b]) =>
					a.priority - b.priority || (kindA < kindB ? -1 : kindA > kindB ? 1 : 0)
			)
			.map(([, opener]) => opener);
	}
	return orderedCache;
}

/**
 * Registry-derived paragraph-interrupt check. A grammar read like
 * getOrderedOpeners, so it carries the same seam duties: flush pending
 * registration checks, trip the grammar-consumed latch.
 */
export function lineInterruptsParagraph(lineText: string): boolean {
	if (hasPendingRegistrationChecks()) flushPendingRegistrationChecks();
	markGrammarConsumed();
	if (!interruptCache) {
		interruptCache = [...openers.values()]
			.map((o) => o.interruptsParagraph)
			.filter((p): p is (lineText: string) => boolean => p !== false);
	}
	for (const predicate of interruptCache) {
		if (predicate(lineText)) return true;
	}
	return false;
}

/** Registry introspection for the invariant guard (G1.10). */
export function listRegisteredOpeners(): { kind: AnyBlockKind; priority: number }[] {
	return [...openers.entries()].map(([kind, o]) => ({ kind, priority: o.priority }));
}

// Opener tests own the whole registry (register a controlled set after a full
// clear). Also resets the registration-check latches — a grammar-consumed or
// first-flush latch outliving the registry it shadows would mislabel the next
// controlled set as late registrations.
export function __resetBlockOpenersForTests(): void {
	openers.clear();
	orderedCache = null;
	interruptCache = null;
	__resetRegistrationChecksForTests();
}

// The unified schema reset preserves built-ins for tests that merely add plugin kinds.
export function __removePluginOpenersForTests(): void {
	for (const kind of openers.keys()) {
		if (!isBuiltinBlockKind(kind)) openers.delete(kind);
	}
	orderedCache = null;
	interruptCache = null;
}
