import { activationFor } from '#lib/schema/plugin-activation.js';
import { createEditorGrammar } from '#lib/schema/editor-grammar.js';
import type { GrammarView } from '#lib/schema/block-openers.js';

/** The grammar of an editor whose `plugins` prop lists exactly `names`. */
export function grammarListing(names: string[]): GrammarView {
	return createEditorGrammar({ plugins: activationFor(names) });
}
