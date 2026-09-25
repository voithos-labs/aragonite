// The editor grammar a unit fixture reads when it models an editor with no `plugins` or `syntax`
// prop: every installed plugin. Each shape that carries the grammar gets it from here.
import type { RenderInlineOptions } from '$lib/core/inline-render';
import type { LinkReferenceResolverRef } from '$lib/editor-keys';
import { defaultGrammarView, type GrammarView } from '$lib/schema/block-openers';
import type { Reading } from '$lib/schema/reading';
import { hidesDelimitersAtCaret } from '$lib/presentation-mode';
import type { PasteSeam } from '$lib/tree-operations/paste-surfaces';

/** The grammar itself, for a tree operation that takes it bare. */
export const fixtureGrammar: GrammarView = defaultGrammarView;

/** Render options with the fixture grammar, plus the fixture's own. */
export function renderOptions(over: Partial<RenderInlineOptions> = {}): RenderInlineOptions {
	return { grammar: defaultGrammarView, ...over };
}

/** A link-reference ref with the fixture grammar and no definitions unless `over` names some.
 *  Copied by property descriptor, so a getter in `over` stays live. */
export function fixtureLinkRef(
	over: Partial<LinkReferenceResolverRef> = {}
): LinkReferenceResolverRef {
	const ref: LinkReferenceResolverRef = { grammar: defaultGrammarView };
	return Object.defineProperties(ref, Object.getOwnPropertyDescriptors(over));
}

/** An editor's reading with the fixture grammar, no definitions and styled source, unless
 *  `over` names its own. Copied by property descriptor, so a getter in `over` stays live. */
export function fixtureReading(over: Partial<Reading> = {}): Reading {
	const reading: Reading = {
		grammar: defaultGrammarView,
		current: undefined,
		signature: '',
		epoch: 0,
		mode: () => 'source',
		hidesDelimitersAtCaret: () => hidesDelimitersAtCaret(reading.mode())
	};
	return Object.defineProperties(reading, Object.getOwnPropertyDescriptors(over));
}

/** A paste hook's join context outside any mode, so the delete half cuts byte-literally. */
export function pasteSeam(over: Partial<PasteSeam> = {}): PasteSeam {
	return { presentationMode: undefined, linkRef: fixtureLinkRef(), ...over };
}
