// A grammar whose opener list leaves out built-in kinds, for a test of a route that must read the
// editor's grammar rather than every opener: the same effect a plugin left off the list has.
import { openerRecords } from '#lib/schema/block-kind-descriptor.js';
import { createEditorGrammar, type EditorGrammar } from '#lib/schema/editor-grammar.js';

export function grammarWithout(...kinds: string[]): EditorGrammar {
	const base = createEditorGrammar();
	const all = base.orderedOpeners();
	const dropped = new Set(
		openerRecords()
			.filter((record) => kinds.includes(record.key as string))
			.map((record) => record.value)
	);
	const kept = all.filter((opener) => !dropped.has(opener));
	return { ...base, orderedOpeners: () => kept };
}
