/**
 * One editor's inline syntax, as its parse reads it: the handlers it asks at each character, in
 * order, the characters the parse stops at, and the triggers that pair as they're typed. Built
 * from the editor's own grammar (its plugins' `inline()` constructs first, then the core's handlers
 * and the registrar's records for the plugins it runs) once per change, so the parse never asks
 * which plugin a handler answers to.
 */
import type { GrammarView } from '../../../schema/block-openers';
import type { InstalledInline } from '../../../schema/inline-type';
import type { AnyInlineKind } from '../../nodes';
import { everyInstalledPlugin, resolvesIn } from '../../../schema/plugin-activation';
import { recordEveryPluginTable, recordInlineTableBuild } from '../../../perf/instruments';
import { pluginInstallGeneration } from '../../../schema/plugin-install';
import { enrollTestReset } from '../../../schema/registry-reset';
import {
	byHandlerOrder,
	registeredHandlers,
	registryVersion,
	type HandlerRecord,
	type InlineHandler,
	type ScopedRecognizer
} from './plugin-syntax';

export interface InlineTable {
	/** The handlers on `char`, in the order the parse asks them. */
	handlers(char: string): readonly InlineHandler[];
	/** Every position the parse may read: the built-in characters, bare url starts and triggers. */
	readonly specials: RegExp;
	/** Whether typing `char` writes its closer after the caret. */
	pairs(char: string): boolean;
	/** The plugin mark whose runs `char` writes, and their length; undefined for any other. */
	mark(char: string): { readonly kind: AnyInlineKind; readonly length: number } | undefined;
}

/** The table `grammar` reads; the same object until a handler, a plugin or its list changes. */
export function inlineTable(grammar: GrammarView): InlineTable {
	const { activation } = grammar;
	if (activation === everyInstalledPlugin) recordEveryPluginTable();
	const held = tables.get(grammar);
	const own = grammar.inlines?.() ?? NO_INLINES;
	if (
		held &&
		held.registry === registryVersion() &&
		held.core === coreVersion &&
		held.installs === pluginInstallGeneration() &&
		held.list === activation.generation &&
		held.own === own
	)
		return held.table;
	const table = buildTable(grammar, own);
	tables.set(grammar, {
		registry: registryVersion(),
		core: coreVersion,
		installs: pluginInstallGeneration(),
		list: activation.generation,
		own,
		table
	});
	return table;
}

/** A handler of the editor's own (directive text): every grammar carries it once it's added. */
export function addCoreInlineHandler(trigger: string, recognizer: ScopedRecognizer): void {
	const handler = { prefix: trigger, priority: CORE_PRIORITY, recognizer, owner: null };
	core.push({ trigger, autoPair: false, handler });
	coreVersion++;
}

// ── Internal ─────────────────────────────────────────────────────────────────

const BUILT_IN_SPECIALS = /[\\`&\n*_~[\]!<@]|[wW]{3}\.|[hH][tT]{2}[pP][sS]?:\/\//g;

// Where a core handler sits among a character's registered ones: a bare registration's default.
const CORE_PRIORITY = 100;

const core: HandlerRecord[] = [];
let coreVersion = 0;
enrollTestReset(() => {
	core.length = 0;
	coreVersion++;
});

interface Held {
	registry: number;
	core: number;
	installs: number;
	list: number | undefined;
	own: ReadonlyMap<AnyInlineKind, InstalledInline>;
	table: InlineTable;
}

const NO_INLINES: ReadonlyMap<AnyInlineKind, InstalledInline> = new Map();

const tables = new WeakMap<GrammarView, Held>();
const NONE: readonly InlineHandler[] = [];

function buildTable(
	grammar: GrammarView,
	own: ReadonlyMap<AnyInlineKind, InstalledInline>
): InlineTable {
	recordInlineTableBuild();
	const byChar = new Map<string, InlineHandler[]>();
	const pairing = new Set<string>();
	for (const { trigger, autoPair, handler } of [...core, ...registeredHandlers()]) {
		if (!resolvesIn(grammar.activation, handler.owner)) continue;
		byChar.set(trigger, [...(byChar.get(trigger) ?? []), handler]);
		if (autoPair) pairing.add(trigger);
	}
	for (const list of byChar.values()) list.sort(byHandlerOrder);
	const marks = new Map<string, { kind: AnyInlineKind; length: number }>();
	for (const { kind, trigger, mark } of own.values()) {
		if (mark) marks.set(trigger, { kind, length: mark.marker.length });
	}
	for (const [trigger, constructs] of ownByChar(own)) {
		const handlers = constructs.flatMap((c) => c.handler ?? []);
		byChar.set(trigger, [...handlers, ...(byChar.get(trigger) ?? [])]);
		if (constructs.some((c) => c.pair)) pairing.add(trigger);
	}
	const triggers = [...new Set([...byChar.keys(), ...marks.keys()])]
		.map((c) => c.replace(/[\\\]^-]/, '\\$&'))
		.join('');
	return {
		handlers: (char) => byChar.get(char) ?? NONE,
		specials: triggers
			? new RegExp(`${BUILT_IN_SPECIALS.source}|[${triggers}]`, 'g')
			: BUILT_IN_SPECIALS,
		pairs: (char) => pairing.has(char),
		mark: (char) => marks.get(char)
	};
}

/** The editor's own constructs per character, in the order they're tried: the longer prefix, then
 *  the name, then each placed after the ones its `after` names. */
function ownByChar(
	own: ReadonlyMap<AnyInlineKind, InstalledInline>
): Map<string, InstalledInline[]> {
	const byChar = new Map<string, InstalledInline[]>();
	for (const construct of own.values()) {
		if (!construct.handler) continue;
		byChar.set(construct.trigger, [...(byChar.get(construct.trigger) ?? []), construct]);
	}
	for (const [trigger, list] of byChar) {
		list.sort(
			(a, b) => b.handler!.prefix.length - a.handler!.prefix.length || (a.kind < b.kind ? -1 : 1)
		);
		byChar.set(trigger, afterOrder(list));
	}
	return byChar;
}

// Stable: each round takes the first construct whose `after` names are all placed; a cycle keeps
// the rest in their sorted order.
function afterOrder(list: InstalledInline[]): InstalledInline[] {
	const placed: InstalledInline[] = [];
	const waiting = [...list];
	const names = new Set(list.map((c) => c.kind as string));
	while (waiting.length > 0) {
		const ready = waiting.findIndex((c) =>
			c.after.every(({ name }) => !names.has(name) || placed.some((p) => p.kind === name))
		);
		placed.push(waiting.splice(ready < 0 ? 0 : ready, 1)[0]);
	}
	return placed;
}
