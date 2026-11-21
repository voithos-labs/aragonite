// G4.369: the process-wide block-command and paste-transform names keep the callers they have, so
// nothing new is built on the surface a plugin value's `chords`, `actions`, `commands` and
// `rewrites` replace. A file that drops its last use leaves the list; a file that gains one fails.
import { describe, expect, it } from 'vitest';
import { collectEditorSources, REPO_WIDE_ROOTS, ROUTES_SRC, sourceFile } from './scan-source';

const RETIRING = new RegExp(
	`\\b(?:${[
		'registerBlockCommand',
		'BlockCommandContext',
		'BlockCommandHandler',
		'BlockCommandOptions',
		'BlockCommandTarget',
		'CommandRun',
		'PluginCommandId',
		'AnyCommandId',
		'registerPasteTransform',
		'PasteTransform',
		'applyPasteTransforms'
	].join('|')})\\b`
);

/** The production files that name one of them today. */
const CALLERS: readonly string[] = [
	'src/lib/action-contracts.ts',
	'src/lib/block-component.ts',
	'src/lib/caret/caret-memory.ts',
	'src/lib/components/Editor.svelte',
	'src/lib/components/blocks/code/CodeBlock.svelte',
	'src/lib/components/blocks/editable/editable-leaf.ts',
	'src/lib/components/blocks/editable/surface-wiring.svelte.ts',
	'src/lib/components/blocks/list/ListItemBlock.svelte',
	'src/lib/components/blocks/table/cell-table-commands.ts',
	'src/lib/components/blocks/text/TextEditableBlock.svelte',
	'src/lib/editor-actions/container-block-component.ts',
	'src/lib/editor-actions/container-exit-overrides.ts',
	'src/lib/editor-actions/enter-completion.ts',
	'src/lib/editor-actions/list-overrides.ts',
	'src/lib/plugin.ts',
	'src/lib/schema/block-commands.ts',
	'src/lib/schema/block-view.ts',
	'src/lib/schema/command-id.ts',
	'src/lib/schema/commands.ts',
	'src/lib/schema/inline-construct-policy.ts',
	'src/lib/schema/keybinding-overrides.ts',
	'src/lib/schema/keybindings.ts',
	'src/lib/schema/range-indent-forms.ts',
	'src/lib/selection/cross-block/keydown.ts',
	'src/lib/testing.ts',
	'src/lib/tree-operations/paste/paste-rewrites.ts',
	'src/lib/tree-operations/paste/paste-transforms.ts',
	'packages/admonitions/src/admonition-kind.ts',
	'packages/admonitions/src/convert-document.ts',
	'packages/mermaid/src/mermaid-kind.ts',
	'src/routes/test/plugins/callout/callout-kind.ts',
	'src/routes/test/plugins/memo/memo-kind.ts'
];

describe('G4.369 the retiring plugin names gain no caller', () => {
	const naming = collectEditorSources([...REPO_WIDE_ROOTS, ROUTES_SRC])
		.filter((file) => RETIRING.test(file.code))
		.map((file) => file.relPath);

	it('are named in exactly the files listed', () => {
		const added = naming.filter((path) => !CALLERS.includes(path));
		const gone = CALLERS.filter((path) => !naming.includes(path));
		const reason =
			'build a new command on a block type’s `chords` or `actions`, or a `command` in `commands`, and a paste rewrite on `rewrites`; a file that no longer names one leaves CALLERS';
		expect({ added, gone }, reason).toEqual({ added: [], gone: [] });
	});

	it('count a name in code, whole, and not in a comment', () => {
		const names = (code: string) => RETIRING.test(sourceFile('probe.ts', code).code);
		expect(names('registerBlockCommand(kind, name, handler);')).toBe(true);
		expect(names('const id: AnyCommandId = run;')).toBe(true);
		expect(names('registerBlockCommands(kind);')).toBe(false);
		expect(names('// registerBlockCommand is retiring')).toBe(false);
	});
});
