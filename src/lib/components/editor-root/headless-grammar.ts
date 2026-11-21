/**
 * A plugin list's grammar with no editor: `grammar(plugins).parse(text)` reads text into a `Doc`
 * as an editor running those plugins reads it, its blocks placed in the text's bytes. The plugins'
 * block types stay known to the process while the grammar is reachable, as a mounted editor's do.
 */
import { devWarn } from '@voithos-labs/aragonite/dev-checks';
import type { AnyBlockKind } from '../../core/nodes';
import { blockKindLabel } from '../../a11y-strings';
import { createDocumentRead } from '../../editor-actions/commit/document-read';
import { measured } from '../../tree-operations/top-level-starts';
import { createEditorActivation } from '../../schema/plugin-activation';
import { createEditorGrammar, type SyntaxOptions } from '../../schema/editor-grammar';
import { installBlockTypes } from '../../schema/block-type';
import {
	installPluginList,
	type BlockType,
	type InstalledPlugin,
	type PluginError,
	type PluginList
} from '../../schema/plugin-unit';
import type { Doc } from '../../schema/doc-view';
import { initDocument } from './document-swap';

/** What `grammar` hands back: a parse that reads text the way those plugins' editor would. */
export interface Grammar {
	parse(text: string): Doc;
}

export function grammar(plugins: PluginList, options: { syntax?: SyntaxOptions } = {}): Grammar {
	const units = installPluginList(plugins, reportOutsideEditor);
	const types = installBlockTypes(units, reportOutsideEditor);
	const view = createEditorGrammar({
		plugins: createEditorActivation(units.map((unit) => unit.name)),
		syntax: options.syntax,
		blocks: () => types.blocks
	});
	return {
		parse(text) {
			const { doc, resolver, signature } = initDocument(text, view);
			const of = measured(doc);
			return createDocumentRead({
				getDoc: () => doc,
				measured: () => of,
				typeOf: (kind) => blockTypeIn(units, kind),
				reading: { grammar: view, resolver, resolverSignature: signature },
				version: () => 0,
				source: () => text
			}).doc();
		}
	};
}

/** A plugin's own block type, else one named by its kind, which `is` matches to `builtin.blocks`. */
export function blockTypeIn(
	units: readonly InstalledPlugin[],
	kind: AnyBlockKind
): BlockType<unknown> {
	for (const unit of units) {
		const own = unit.contribution.blocks?.find((type) => type.name === kind);
		if (own) return own;
	}
	return { name: kind, label: blockKindLabel(kind) };
}

// With no editor to hear it, a plugin left out says so in a dev build, as an unheard one does.
function reportOutsideEditor(error: PluginError): void {
	devWarn('plugin-error', `plugin '${error.plugin}' failed (${error.doing})`, error.cause);
}
