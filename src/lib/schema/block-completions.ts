/**
 * Per-kind Enter-completion registry, the block-opener registry's sibling: an opener recognizes
 * a line while parsing, a completer recognizes a lone typed line when Enter is pressed and
 * returns the canonical lines that complete it. Part of `plugin.ts`, so its plugin entries clear
 * through `registry-reset.ts` like every other public register-once registry.
 */

import { isBuiltinBlockKind, type AnyBlockKind } from '../core/nodes';
import { deletePluginEntries, registerOnce } from './register-once';
import { ownerEnabled, type GrammarView } from './block-openers';
import { pluginKindOwner } from './plugin-install';

/**
 * The replacement, as lines with no line endings: the Enter handler attaches the block's own
 * (G4.20). `caret.path` is the child indices inside the new block, empty for the block itself,
 * and `line`/`column` are a position inside that node. Line-relative rather than a byte offset
 * because the Enter handler picks the line ending afterwards, so only it can count bytes.
 */
export interface CompletionResult {
	lines: string[];
	caret: { path: number[]; line: number; column: number };
}

export interface BlockCompleter {
	/** Attempt to complete `line`; null declines, and so does a result whose lines render nothing. */
	tryComplete(line: string): CompletionResult | null;
	/**
	 * Also consulted as the line is typed, not only at Enter, for a line that can only mean one
	 * thing the moment it is complete (a lone `$$`), so the block forms the way a ` ``` ` fence
	 * does. Off by default: a table's header row is the start of a longer row the user may still
	 * be typing.
	 */
	onType?: boolean;
}

const completers = new Map<AnyBlockKind, BlockCompleter>();
let orderedCache: [AnyBlockKind, BlockCompleter][] | null = null;

export function registerBlockCompleter(kind: AnyBlockKind, completer: BlockCompleter): void {
	registerOnce(
		completers.has(kind),
		() => {
			completers.set(kind, completer);
			orderedCache = null;
		},
		`registerBlockCompleter: "${kind}" is already registered. Completers are register-once.`
	);
}

// Kind-name order, so which completer runs first depends on the declarations and never on
// registration order. The openers' rule, without a priority number no conflict has needed yet.
function ordered(): readonly [AnyBlockKind, BlockCompleter][] {
	if (!orderedCache) {
		orderedCache = [...completers.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	}
	return orderedCache;
}

/** The first completion for `line`, or null when no completer the editor's grammar allows takes
 *  it. A kind's completer belongs to the plugin that declared the kind. */
export function completeTypedLine(line: string, grammar: GrammarView): CompletionResult | null {
	for (const [kind, completer] of ordered()) {
		if (!ownerEnabled(grammar, pluginKindOwner(kind))) continue;
		const claim = completer.tryComplete(line);
		if (claim) return claim;
	}
	return null;
}

/** The first completion for `line` among the completers that answer as the line is typed. */
export function completeLineOnType(line: string, grammar: GrammarView): CompletionResult | null {
	for (const [kind, completer] of ordered()) {
		if (!completer.onType || !ownerEnabled(grammar, pluginKindOwner(kind))) continue;
		const claim = completer.tryComplete(line);
		if (claim) return claim;
	}
	return null;
}

/** Does `kind` already have a completer? A plugin that may register twice checks this first,
 *  so re-installing it never trips the register-once throw. */
export function isBlockCompleterRegistered(kind: string): boolean {
	return completers.has(kind as AnyBlockKind);
}

export function __resetBlockCompletersForTests(): void {
	completers.clear();
	orderedCache = null;
}

// The shared schema reset keeps built-ins, for tests that only add plugin kinds.
export function __removePluginCompletersForTests(): void {
	deletePluginEntries(completers, isBuiltinBlockKind);
	orderedCache = null;
}
