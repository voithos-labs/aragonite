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
	if (openers.has(kind)) {
		throw new Error(
			`registerBlockOpener: "${kind}" is already registered. Openers are register-once.`
		);
	}
	openers.set(kind, opener);
	orderedCache = null;
	interruptCache = null;
}

/** Priority-ascending; cached — the parser loops this per block. */
export function getOrderedOpeners(): readonly BlockOpener[] {
	if (!orderedCache) {
		orderedCache = [...openers.values()].sort((a, b) => a.priority - b.priority);
	}
	return orderedCache;
}

/** Registry-derived paragraph-interrupt check. */
export function lineInterruptsParagraph(lineText: string): boolean {
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

// Opener tests own the whole registry (register a controlled set after a full clear).
export function __resetBlockOpenersForTests(): void {
	openers.clear();
	orderedCache = null;
	interruptCache = null;
}

// The unified schema reset preserves built-ins for tests that merely add plugin kinds.
export function __removePluginOpenersForTests(): void {
	for (const kind of openers.keys()) {
		if (!isBuiltinBlockKind(kind)) openers.delete(kind);
	}
	orderedCache = null;
	interruptCache = null;
}
