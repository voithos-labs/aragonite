/**
 * Per-kind Enter-completion registry, the block-opener registry's sibling: an opener recognizes
 * a line while parsing, a completer recognizes a lone typed line when Enter is pressed and
 * returns the canonical lines that complete it.
 */

import { isBuiltinBlockKind, type AnyBlockKind } from '../core/nodes';
import type { GrammarView } from './block-openers';
import { resolvesIn } from './plugin-activation';
import { createPluginRegistry, type RegistryRecord } from './plugin-registry';
import { pluginKindOwner } from './plugin-kind';

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

let orderedCache: RegistryRecord<AnyBlockKind, BlockCompleter>[] | null = null;

const completers = createPluginRegistry<AnyBlockKind, BlockCompleter>({
	label: 'registerBlockCompleter',
	isBuiltin: isBuiltinBlockKind,
	ownerOf: pluginKindOwner,
	onChange: () => (orderedCache = null)
});

export function registerBlockCompleter(kind: AnyBlockKind, completer: BlockCompleter): void {
	completers.register(
		kind,
		completer,
		`registerBlockCompleter: "${kind}" is already registered. Completers are register-once.`
	);
}

// Kind-name order, so which completer runs first depends on the declarations and never on
// registration order. The openers' rule, without a priority number no conflict has needed yet.
function ordered(): readonly RegistryRecord<AnyBlockKind, BlockCompleter>[] {
	if (!orderedCache) {
		orderedCache = completers
			.records()
			.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
	}
	return orderedCache;
}

/** The first completion for `line`, or null when no completer the editor's grammar allows takes it. */
export function completeTypedLine(line: string, grammar: GrammarView): CompletionResult | null {
	for (const { value: completer, owner } of ordered()) {
		if (!resolvesIn(grammar.activation, owner)) continue;
		const claim = completer.tryComplete(line);
		if (claim) return claim;
	}
	return null;
}

/** The first completion for `line` among the completers that answer as the line is typed. */
export function completeLineOnType(line: string, grammar: GrammarView): CompletionResult | null {
	for (const { value: completer, owner } of ordered()) {
		if (!completer.onType || !resolvesIn(grammar.activation, owner)) continue;
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
