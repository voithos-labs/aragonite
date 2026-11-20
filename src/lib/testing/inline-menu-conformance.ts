/**
 * The conformance cell for a caret menu's pick, published at `@voithos-labs/aragonite/testing`. A
 * pick that waits (a fetch, a picker) can outlive the note it was picked in: this holds one across a
 * `source` swap and fails if it still writes.
 */

import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import { measured } from '../tree-operations/top-level-starts';
import { createDraftRegistry } from '../editor-actions/commit/draft-registry.svelte';
import { createDocumentStamps } from '../editor-actions/commit/document-stamp';
import { createMenuPick } from '../schema/caret-menu';
import { installPluginList, type Editor, type PluginList } from '../schema/plugin-unit';
import { defaultGrammarView } from '../schema/editor-grammar';

export interface MenuPickCase {
	/** The plugin value whose first caret menu is picked from; its `setup` runs first. */
	plugin: PluginList[number];
	/** The row the author picks, as the menu's `rows` would give it. */
	row: unknown;
	/** What was typed after the trigger; empty by default. */
	query?: string;
	/** Lets the pick's own wait finish; the cell calls it once the swap has landed. */
	release(): void;
}

/** Picks `row`, swaps the document while the pick waits, releases it, and throws if the pick wrote
 *  anything after the swap, through its `MenuPick` or an editor it kept from `setup`. */
export async function checkMenuPickAcrossSwap(c: MenuPickCase): Promise<void> {
	const writes: string[] = [];
	const stamps = createDocumentStamps();
	let document = parse('\n');
	const drafts = createDraftRegistry({
		stamps,
		// No write is open while a pick commits.
		starts: { writing: () => false, vouch: () => true },
		events: { emit() {} },
		doc: () => document,
		measured: () => measured(document),
		source: () => serialize(document),
		isReading: () => false,
		isOn: () => true,
		grammar: defaultGrammarView,
		writes: () => ({
			commitSource: async () => (writes.push('a draft commit'), true),
			undoStep: async (_seed, run) => void (await run()),
			insert: async (md) => (writes.push(`an insert of ${JSON.stringify(md)}`), true)
		})
	});
	const [unit] = installPluginList([c.plugin], ({ cause }) => {
		throw cause;
	});
	const editor = recordingEditor(writes, () => drafts.edit(), c.plugin.name);
	unit.contribution.setup?.(editor);
	const menu = unit.contribution.menus?.[0];
	if (!menu) throw new Error(`plugin '${c.plugin.name}' contributes no caret menu`);

	const query = c.query ?? '';
	document = parse(`${menu.trigger}${query}\n`);
	const range = { from: 0, to: menu.trigger.length + query.length };
	const pick = createMenuPick({
		draft: drafts.edit(undefined, range),
		trigger: menu.trigger,
		query,
		range,
		removeQuery: async () => (writes.push('a removal of the query'), { lineHasText: false }),
		editor: () => editor,
		undoStep: (run) => run().then(() => {})
	});
	const picked = menu.pick(c.row, pick);
	stamps.retire();
	drafts.closeAll('document-swap');
	document = parse('another note\n');
	const before = writes.length;
	c.release();
	try {
		await picked;
	} finally {
		pick.end();
	}
	const late = writes.slice(before);
	if (late.length > 0) {
		throw new Error(
			`plugin '${c.plugin.name}': its menu's pick made ${late.join(', ')} after the host loaded ` +
				`another document; write through the pick the menu hands you`
		);
	}
}

// ── Internal ────────────────────────────────────────────────────────────────

/** An editor whose writes are recorded; the rest answers as an empty editor would. */
function recordingEditor(writes: string[], edit: Editor['edit'], plugin: string): Editor {
	return {
		plugins: [plugin],
		mode: 'source',
		theme: 'light',
		inserts: [],
		on: () => () => {},
		run: (command: { id: string } | string) => (
			writes.push(`a run of ${typeof command === 'string' ? command : command.id}`),
			true
		),
		can: () => true,
		claims: () => false,
		openMenu: () => false,
		openRows: () => ({ isOpen: false, close() {} }),
		edit,
		blockAt: () => null,
		selectedRange: () => null,
		repaint: () => {}
	};
}
