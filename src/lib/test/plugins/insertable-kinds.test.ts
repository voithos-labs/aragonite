// Every block kind a bundled plugin installs can be made from `/` and the Insert menu: some insert
// entry's Markdown parses to a tree holding it, or the kind is listed with why it has none (G4.157).
// Miss-analysis: each plugin added its entry by hand, and nothing compared the entries with the
// kinds the plugins install, so details, mermaid and the table of contents shipped with none.
import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { walkBlocks } from '#lib/core/paths.js';
import { getAllRegisteredKinds } from '#lib/schema/block-kind-descriptor.js';
import { insertCatalogue } from '#lib/schema/insert-catalogue.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import { installPlugins, type EditorPlugin } from '#lib/schema/plugin-install.js';
import { pluginKindOwner } from '#lib/schema/plugin-kind.js';
import { bundledPluginDirs } from '../invariants/lint/scan-source';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { detailsPlugin } from '#lib/plugins/details/index.js';
import { emojiPlugin } from '#lib/plugins/emoji/index.js';
import { footnotesPlugin } from '#lib/plugins/footnotes/index.js';
import { highlightOccurrencesPlugin } from '#lib/plugins/highlight-occurrences/index.js';
import { latexPlugin } from '#lib/plugins/latex/index.js';
import { mermaidPlugin } from '#lib/plugins/mermaid/index.js';
import { parrotPlugin } from '#lib/plugins/parrot/index.js';
import { slashCommandsPlugin } from '#lib/plugins/slash-commands/index.js';
import { tocPlugin } from '#lib/plugins/toc/index.js';

/** Every bundled plugin by its directory, so a plugin added on disk fails until it is listed. */
const BUNDLED: Record<string, () => EditorPlugin> = {
	admonitions: admonitionsPlugin,
	details: detailsPlugin,
	emoji: emojiPlugin,
	footnotes: footnotesPlugin,
	'highlight-occurrences': () => highlightOccurrencesPlugin(),
	latex: latexPlugin,
	mermaid: mermaidPlugin,
	parrot: parrotPlugin,
	'slash-commands': slashCommandsPlugin,
	toc: tocPlugin
};

/** A plugin kind no insert entry makes, and why. */
const NOT_INSERTED: Record<string, string> = {
	'footnote-def': 'typing `[^x]:` makes one, under the reference it belongs to',
	githubAlert: 'the note entry inserts the admonition spelling of the same callout',
	mathFence: 'the math entry inserts the `$$` spelling of the same block',
	parrot: "the plugin guide's toy block, not one a writer reaches for"
};

beforeEach(() => {
	installPlugins(Object.values(BUNDLED).map((plugin) => plugin()));
});

function installedPluginKinds(): string[] {
	return getAllRegisteredKinds().filter((kind) => pluginKindOwner(kind) !== null);
}

/** Every kind in the trees the catalogue's entries parse to, title rows and children included. */
function insertedKinds(): Set<string> {
	const kinds = new Set<string>();
	for (const entry of insertCatalogue(everyInstalledPlugin)) {
		walkBlocks(parse(entry.markdown), (node) => void kinds.add(node.kind));
	}
	return kinds;
}

describe('insertable plugin kinds', () => {
	it('enrolls every bundled plugin directory', () => {
		expect(Object.keys(BUNDLED).sort()).toEqual(bundledPluginDirs());
	});

	it('inserts every installed plugin kind from an entry, or lists why not', () => {
		const inserted = insertedKinds();
		const missing = installedPluginKinds().filter(
			(kind) => !inserted.has(kind) && !(kind in NOT_INSERTED)
		);
		expect(missing, 'a plugin kind with no insert entry and no listed reason').toEqual([]);
	});

	it('lists a kind only while it is installed and no entry inserts it', () => {
		const installed = new Set(installedPluginKinds());
		const inserted = insertedKinds();
		const stale = Object.keys(NOT_INSERTED).filter(
			(kind) => !installed.has(kind) || inserted.has(kind)
		);
		expect(stale, 'a listed kind that is gone or now has an entry').toEqual([]);
	});

	it('registers the details entry with the list-collapse icon', () => {
		const entry = insertCatalogue(everyInstalledPlugin).find((e) => e.id === 'details');
		expect(entry?.icon).toBe('list-collapse');
	});
});
