// The grammar a suite reads with when it reads the bundled syntax without mounting an editor: the
// listed plugin values' own types, beside every page-wide registration, which a bare `parse()`
// alone would read. Make one inside each test, after the platform reset.
import {
	createEditorGrammar,
	type EditorGrammar,
	type SyntaxOptions
} from '#lib/schema/editor-grammar.js';
import { listGrammar } from '#lib/schema/own-syntax.js';
import type { PluginList } from '#lib/schema/plugin-unit.js';
import { SYNTAX_PLUGINS } from '../behavior/corpus';

export function syntaxGrammar(
	plugins: PluginList = SYNTAX_PLUGINS,
	options: { syntax?: SyntaxOptions } = {}
): EditorGrammar {
	const list = listGrammar(plugins, ({ cause }) => {
		throw cause;
	});
	return createEditorGrammar({
		syntax: options.syntax,
		blocks: () => list.blocks,
		inlines: () => list.inlines
	});
}
