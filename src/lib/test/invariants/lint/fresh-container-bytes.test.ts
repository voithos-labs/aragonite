/**
 * G4.109: a container built around children lifted from another starts from the source's bytes,
 * since its rebuild keeps each line by pairing it with the container's previous bytes. An empty
 * `raw` there respells every line, so only builders of a genuinely new container may write one.
 */

import {
	balancedRegion,
	collectEditorSources,
	fileClasses,
	openerBefore,
	splitTopLevel,
	type SourceFile
} from './scan-source';
import { describeFileRules, under, type FileRule } from './file-rule';

/** Whether the file holds an object literal with both an empty `raw` and a `children` key. */
function hasEmptyContainerLiteral(file: SourceFile): boolean {
	const classes = fileClasses(file);
	return [...file.code.matchAll(/\braw\s*:\s*''/g)].some((m) => {
		const literal = objectLiteralAround(file.code, m.index, classes);
		const keys = literal === null ? [] : splitTopLevel(literal.slice(1, -1), ',');
		return keys.some((key) => /^children\b\s*(?::|$)/.test(key));
	});
}

/** The object literal `at` sits in, braces included, or null outside one. */
function objectLiteralAround(code: string, at: number, classes: Uint8Array): string | null {
	const open = openerBefore(code, at, classes);
	return open !== null && code[open] === '{' ? balancedRegion(code, open) : null;
}

const RULES: FileRule[] = [
	{
		id: 'G4.109 a container built around existing children starts from its source’s bytes',
		population: under('src/lib/tree-operations/', 'src/lib/editor-actions/', 'src/lib/selection/'),
		matches: hasEmptyContainerLiteral,
		allowed: {
			'src/lib/tree-operations/list/list-builders.ts':
				'a list shell, whose bytes are its items’ own, and a list item built from metadata alone',
			'src/lib/tree-operations/list/unwrap-merge.ts':
				'the list shell left after an unwrap, whose bytes are its items’ own',
			'src/lib/tree-operations/list/task-paragraph.ts':
				'a trial item, written in the container’s own spelling and dropped',
			'src/lib/tree-operations/sub-table-copy.ts':
				'the rows of a table a rectangular copy builds from cell text',
			'src/lib/tree-operations/table-mutations.ts': 'a new empty row',
			'src/lib/selection/clipboard-text.ts':
				'a container written around a copied body, a node the document never held'
		},
		reason:
			'a container built around children that came from another has an empty `raw`, so its first rebuild respells every line: start it from the source container’s `raw`, or allow it here with why it is new',
		reaches: ['src/lib/tree-operations/blockquote.ts'],
		hits: [
			{
				relPath: 'src/lib/tree-operations/x.ts',
				code: "const q = { kind: 'blockquote', raw: '', children };"
			},
			{
				relPath: 'src/lib/editor-actions/x.ts',
				code: "const q = {\n\tkind: 'listItem',\n\traw: '',\n\tmetadata: { marker },\n\tchildren: [p]\n};"
			}
		],
		misses: [
			{
				relPath: 'src/lib/tree-operations/x.ts',
				code: "const q = { kind: 'blockquote', raw: container.raw, children };"
			},
			{
				relPath: 'src/lib/tree-operations/x.ts',
				code: "const cell = { kind: 'tableCell', leadingTrivia: '', raw: '' };\nconst row = { children };"
			},
			{
				relPath: 'src/lib/components/x.ts',
				code: "const q = { kind: 'blockquote', raw: '', children };"
			}
		]
	}
];

describeFileRules(RULES, collectEditorSources());
