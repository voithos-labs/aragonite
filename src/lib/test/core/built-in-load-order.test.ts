// Built-ins register on the first grammar read, so whichever module a host imports first, a parse
// finds every built-in kind and opener (G4.197).
// Miss-analysis: every suite entered through `core/inline` or the editor, the two entries that
// registered the descriptors, so a pipeline entering through the parser never ran under test.
import { describe, expect, it, vi } from 'vitest';

const FIXTURE = [
	'# h',
	'',
	'    code',
	'',
	'```js',
	'x',
	'```',
	'',
	'> q',
	'',
	'- a',
	'',
	'<div>',
	'',
	'[r]: /u',
	'',
	'---',
	'',
	'| a |',
	'| - |',
	'| b |',
	''
].join('\n');

const OPENED_KINDS = [
	'heading',
	'indentedCode',
	'fencedCode',
	'blockquote',
	'list',
	'htmlBlock',
	'linkReferenceDefinition',
	'thematicBreak',
	'table'
];

// The modules on the parser's import cycle, the modules whose built-ins the first read registers,
// and the two entries that always worked.
const ENTRIES = [
	'#lib/core/parser.js',
	'#lib/core/parsers/table-completion.js',
	'#lib/schema/editor-grammar.js',
	'#lib/tree-operations/paste/hooks.js',
	'#lib/core/inline/index.js',
	'#lib/schema/built-in-descriptors.js',
	'#lib/schema/container-rebuilders.js',
	'#lib/core/parsers/list.js',
	'#lib/core/parsers/built-in-openers.js',
	'#lib/schema/block-kind-descriptor.js',
	'#lib/schema/block-openers.js',
	'#lib/index.js'
];

async function parsedKinds(): Promise<string[]> {
	const { parse } = await import('#lib/core/parser.js');
	return parse(FIXTURE)
		.children.map((child) => child.kind)
		.filter((kind) => kind !== 'paragraph');
}

describe('built-ins register on the first grammar read', () => {
	it.each(ENTRIES)(
		'importing %s first still parses every built-in',
		{ timeout: 60_000 },
		async (entry) => {
			vi.resetModules();
			await import(/* @vite-ignore */ entry);
			expect(await parsedKinds()).toEqual(OPENED_KINDS);
			const { getBlockKindDescriptor } = await import('#lib/schema/block-kind-descriptor.js');
			expect(getBlockKindDescriptor('list').isContainer).toBe(true);
		}
	);

	it.each(ENTRIES)(
		'importing %s first, an editor grammar built from a plugin list reads every built-in',
		{ timeout: 60_000 },
		async (entry) => {
			vi.resetModules();
			await import(/* @vite-ignore */ entry);
			const { createEditorGrammar } = await import('#lib/schema/editor-grammar.js');
			const { activationFor } = await import('#lib/schema/plugin-activation.js');
			const { parse } = await import('#lib/core/parser.js');
			const { completeTypedLine } = await import('#lib/schema/block-completions.js');
			const grammar = createEditorGrammar({ plugins: activationFor([]) });
			const kinds = parse(FIXTURE, { grammar }).children.map((child) => child.kind);
			expect(kinds.filter((kind) => kind !== 'paragraph')).toEqual(OPENED_KINDS);
			expect(grammar.interruptsParagraph('# h')).toBe(true);
			expect(completeTypedLine('| a | b |', grammar)).not.toBeNull();
		}
	);

	// Built-ins first registered inside a plugin's setup, by either route, still belong to no plugin,
	// so they outlive the test reset and a setup that throws.
	it.each([
		[
			'a grammar read',
			async () => {
				const { parse } = await import('#lib/core/parser.js');
				return () => void parse('# first read\n');
			}
		],
		[
			'a direct registration',
			async () => {
				const { registerBuiltInDescriptors } = await import('#lib/schema/built-in-descriptors.js');
				return registerBuiltInDescriptors;
			}
		]
	])(
		'keeps the built-ins that %s registered inside a setup, through a reset and a failed setup',
		{ timeout: 60_000 },
		async (_route, load) => {
			vi.resetModules();
			const { definePlugin, installPlugins } = await import('#lib/schema/plugin-install.js');
			const firstRegistration = await load();
			const reader = definePlugin({
				name: 'first-reader',
				setup() {
					firstRegistration();
					throw new Error('setup fails after the first registration');
				}
			});
			expect(() => installPlugins([reader])).toThrow(/setup fails/);
			expect(await parsedKinds()).toEqual(OPENED_KINDS);

			const { resetPluginPlatformForTests } = await import('#lib/testing.js');
			resetPluginPlatformForTests();
			expect(await parsedKinds()).toEqual(OPENED_KINDS);
		}
	);
});
