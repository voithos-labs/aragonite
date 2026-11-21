/**
 * One editor's inline syntax, as its parse reads it: the handlers it asks at each character, in
 * order, the characters the parse stops at, and the triggers that pair as they're typed. Built
 * from the editor's own grammar (the core's handlers, and the registrar's records for the plugins
 * it runs) once per change, so the parse never asks which plugin a handler answers to.
 */
import type { GrammarView } from '../../../schema/block-openers';
import { resolvesIn } from '../../../schema/plugin-activation';
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
}

/** The table `grammar` reads; the same object until a handler, a plugin or its list changes. */
export function inlineTable(grammar: GrammarView): InlineTable {
	const { activation } = grammar;
	const held = tables.get(grammar);
	if (
		held &&
		held.registry === registryVersion() &&
		held.core === coreVersion &&
		held.installs === pluginInstallGeneration() &&
		held.list === activation.generation
	)
		return held.table;
	const table = buildTable(grammar);
	tables.set(grammar, {
		registry: registryVersion(),
		core: coreVersion,
		installs: pluginInstallGeneration(),
		list: activation.generation,
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
	table: InlineTable;
}

const tables = new WeakMap<GrammarView, Held>();
const NONE: readonly InlineHandler[] = [];

function buildTable(grammar: GrammarView): InlineTable {
	const byChar = new Map<string, InlineHandler[]>();
	const pairing = new Set<string>();
	for (const { trigger, autoPair, handler } of [...core, ...registeredHandlers()]) {
		if (!resolvesIn(grammar.activation, handler.owner)) continue;
		byChar.set(trigger, [...(byChar.get(trigger) ?? []), handler]);
		if (autoPair) pairing.add(trigger);
	}
	for (const list of byChar.values()) list.sort(byHandlerOrder);
	const triggers = [...byChar.keys()].map((c) => c.replace(/[\\\]^-]/, '\\$&')).join('');
	return {
		handlers: (char) => byChar.get(char) ?? NONE,
		specials: triggers
			? new RegExp(`${BUILT_IN_SPECIALS.source}|[${triggers}]`, 'g')
			: BUILT_IN_SPECIALS,
		pairs: (char) => pairing.has(char)
	};
}
