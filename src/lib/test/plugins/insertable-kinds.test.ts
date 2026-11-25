// Every block kind a bundled plugin installs can be made from `/` and the Insert menu: some insert
// entry's Markdown parses to a tree holding it, or the kind is listed with why it has none (G4.157).
// Miss-analysis: each plugin added its entry by hand, and nothing compared the entries with the
// kinds the plugins install, so details, mermaid and the table of contents shipped with none.
import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { walkBlocks } from '#lib/core/paths.js';
import { getAllRegisteredKinds } from '#lib/schema/block-kind-descriptor.js';
import { insertRows, rowMarkdown } from '#lib/schema/insert-catalogue.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import {
	installPlugins,
	normalizePluginEntries,
	type PluginsProp
} from '#lib/schema/plugin-install.js';
import { pluginKindOwner } from '#lib/schema/plugin-kind.js';
import { bundledPluginDirs, PLUGIN_VALUE_DIRS } from '../invariants/lint/scan-source';
import { admonitions } from '#packages/admonitions/src/index.js';
import { details } from '#packages/details/src/index.js';
import { emoji } from '#packages/emoji/src/index.js';
import { footnotes } from '#packages/footnotes/src/index.js';
import { highlightOccurrences } from '#packages/highlight-occurrences/src/index.js';
import { latex } from '#packages/latex/src/index.js';
import { mermaidPlugin } from '#packages/mermaid/src/index.js';
import { parrotPlugin } from '#packages/parrot/src/index.js';
import { slashCommands } from '#packages/slash-commands/src/index.js';
import { toc } from '#packages/toc/src/index.js';

/** Every bundled plugin by its directory, so a plugin added on disk fails until it is listed. */
const BUNDLED: Record<string, () => PluginsProp[number]> = {
	admonitions: () => admonitions,
	details: () => details,
	emoji: () => emoji,
	footnotes: () => footnotes,
	'highlight-occurrences': () => highlightOccurrences,
	latex: () => latex,
	mermaid: mermaidPlugin,
	parrot: parrotPlugin,
	'slash-commands': () => slashCommands,
	toc: () => toc
};

/** A plugin kind no insert entry makes, and why. */
const NOT_INSERTED: Record<string, string> = {};

beforeEach(() => {
	installPlugins(normalizePluginEntries(Object.values(BUNDLED).map((plugin) => plugin())).plugins);
});

function installedPluginKinds(): string[] {
	return getAllRegisteredKinds().filter((kind) => pluginKindOwner(kind) !== null);
}

/** Every kind in the trees the catalogue's entries parse to, title rows and children included. */
function insertedKinds(): Set<string> {
	const kinds = new Set<string>();
	for (const entry of insertRows(everyInstalledPlugin)) {
		walkBlocks(parse(rowMarkdown(entry)), (node) => void kinds.add(node.kind));
	}
	return kinds;
}

describe('insertable plugin kinds', () => {
	it('enrolls every bundled plugin directory', () => {
		expect([...Object.keys(BUNDLED), ...PLUGIN_VALUE_DIRS].sort()).toEqual(bundledPluginDirs());
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
});
