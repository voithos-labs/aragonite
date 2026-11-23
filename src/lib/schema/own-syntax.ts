/**
 * What a plugin list adds to an editor's grammar: the block types and inline constructs its plugins
 * contribute, held all of them or none, and, with no editor mounted, the grammar that reads them.
 * An editor, `grammar(plugins)` and `check(plugin)` install a list's own syntax here, so all three
 * read one text alike.
 */
import type { AnyInlineKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { installBlockTypes, type InstalledBlock } from './block-type';
import { installInlines, type InstalledInline } from './inline-type';
import { createEditorContributions, type EditorContributions } from './editor-contributions';
import { createEditorActivation } from './plugin-activation';
import { createEditorGrammar, type EditorGrammar, type SyntaxOptions } from './editor-grammar';
import {
	installPluginList,
	type Editor,
	type InstalledPlugin,
	type PluginError,
	type PluginList
} from './plugin-unit';
import type { Block } from './doc-view';

/** A list's own block types and inline constructs, held until `release`. */
export interface OwnSyntax {
	readonly blocks: readonly InstalledBlock[];
	readonly inlines: ReadonlyMap<AnyInlineKind, InstalledInline>;
	release(): void;
}

/** Holds the block types and inline constructs `units` contribute: all of them, or none where
 *  holding one throws. */
export function installOwnSyntax(
	units: readonly InstalledPlugin[],
	report: (error: PluginError) => void
): OwnSyntax {
	const held: (() => void)[] = [];
	const release = () => held.splice(0).forEach((give) => give());
	try {
		const blocks = installBlockTypes(units, report, held);
		return { blocks, inlines: installInlines(units, report, held), release };
	} catch (error) {
		release();
		throw error;
	}
}

/** A plugin list installed as an editor installs it, with no editor mounted. */
export interface ListGrammar extends OwnSyntax {
	/** The plugins an editor keeps, in list order. */
	readonly units: readonly InstalledPlugin[];
	readonly grammar: EditorGrammar;
	readonly contributions: EditorContributions;
}

export function listGrammar(
	plugins: PluginList,
	report: (error: PluginError) => void,
	options: {
		syntax?: SyntaxOptions;
		/** The editor a plugin's command meets; with none, no command runs. */
		editorFor?: (plugin: string) => Editor | undefined;
		blockOf?: (node: NodeView, path: readonly number[]) => Block;
		pastedReader?: EditorContributions['pastedReader'];
	} = {}
): ListGrammar {
	const contributions = createEditorContributions({
		editorFor: options.editorFor ?? (() => undefined),
		report,
		// With no editor there's no caret to find a block at.
		blocksAround: () => ({ blocks: [] }),
		blockOf: options.blockOf ?? noEditor,
		pastedReader: options.pastedReader ?? (() => ({ doc: noEditor, blockOf: noEditor }))
	});
	const units = contributions.read(installPluginList(plugins, report));
	const own = installOwnSyntax(units, report);
	const grammar = createEditorGrammar({
		plugins: createEditorActivation(
			units.map((unit) => unit.name),
			contributions
		),
		syntax: options.syntax,
		blocks: () => own.blocks,
		inlines: () => own.inlines
	});
	return { ...own, units, grammar, contributions };
}

function noEditor(): never {
	throw new Error('aragonite: a plugin list read with no editor has no block to hand a command');
}
