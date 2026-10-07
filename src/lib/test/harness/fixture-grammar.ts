// The editor reading a unit fixture uses when it models an editor with no `plugins` or `syntax`
// prop: every installed plugin, no link definitions, styled source. Each shape that carries the
// grammar or the reading gets it from here.
import type { RenderInlineOptions } from '#lib/core/inline-render.js';
import { defaultGrammarView, type GrammarView } from '#lib/schema/block-openers.js';
import type { Reading } from '#lib/schema/reading.js';
import type { ChildSlot } from '#lib/tree-operations/list/task-paragraph.js';
import type { NodeView } from '#lib/core/node-views.js';
import type { StoredAs } from '#lib/schema/stored-as.js';
import type { SplitStores } from '#lib/schema/inline-construct-policy.js';
import { storedAsIn } from '#lib/tree-operations/stored-as.js';
import { hidesDelimitersAtCaret, type PresentationMode } from '#lib/presentation-mode.js';

/** The grammar itself, for a tree operation that takes it bare. */
export const fixtureGrammar: GrammarView = defaultGrammarView;

/** Render options with the fixture grammar, plus the fixture's own. */
export function renderOptions(over: Partial<RenderInlineOptions> = {}): RenderInlineOptions {
	return { grammar: defaultGrammarView, ...over };
}

/**
 * The fixture reading with `over`'s fields, copied by property descriptor so a getter stays live,
 * and `mode` in place of its own when given. The delimiter check always follows the result's mode.
 */
export function fixtureReading(over: Partial<Reading> = {}, mode?: PresentationMode): Reading {
	const reading = {
		grammar: defaultGrammarView,
		resolver: undefined,
		resolverSignature: '',
		resolverEpoch: 0,
		mode: (): PresentationMode => 'source'
	} as Reading;
	const { hidesDelimitersAtCaret: _derived, ...fields } = Object.getOwnPropertyDescriptors(over);
	Object.defineProperties(reading, fields);
	if (mode !== undefined) reading.mode = () => mode;
	reading.hidesDelimitersAtCaret = () => hidesDelimitersAtCaret(reading.mode());
	return reading;
}

/** A slot at the top level, where no task marker stands in front of anything. */
export const TOP_SLOT: ChildSlot = { owner: undefined, index: 0 };

/** Where `node` keeps its bytes standing alone at a document's top level, in `reading`. */
export function topLevelStore(node: NodeView, reading: Reading = fixtureReading()): StoredAs {
	return storedAsIn({ owner: undefined, children: [node], lineEnding: '\n' }, 0, reading);
}

/** Where the two halves of `node` are kept when a split cuts it standing alone at the top level. */
export function topLevelSplit(node: NodeView, reading: Reading = fixtureReading()): SplitStores {
	const holder = { owner: undefined, children: [node], lineEnding: '\n' as const };
	return {
		first: storedAsIn(holder, 0, reading),
		second: storedAsIn(holder, 1, reading, node.kind)
	};
}
