/**
 * The `/` menu on a real inline-menu state over one parsed paragraph, typed into a byte at a time.
 * The plugin is read the way an editor reads its list, so its options are the ones an editor
 * merges; the pick's draft and the editor's commands are recorded instead of run, so a test reads
 * what a pick asked for: which Markdown, where, and which command.
 */
import { tick } from 'svelte';
import { parse, type DocumentView } from '#lib';
import { createEditorEvents, type EditEvent } from '#lib/editor-events.js';
import { createInlineMenuState } from '#lib/inline-menu/inline-menu-state.svelte.js';
import { insertRows } from '#lib/schema/insert-catalogue.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import { installPluginList, type Editor, type Plugin } from '#lib/schema/plugin-unit.js';
import type { PickDraft } from '#lib/schema/caret-menu.js';
import type { DraftResult } from '#lib/schema/drafts.js';
import { slashCommands, type SlashCommandsOptions } from '#packages/slash-commands/src/index.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { fixtureReading } from '../../harness/fixture-grammar';

const typedEdit = (path: number[]): EditEvent => ({ op: 'input', path, timestamp: 0 }) as EditEvent;

/** The slash plugin as an editor lists it; `onError` hears what the install reports. */
export function slashHarness(
	initial: string,
	plugin: Plugin<SlashCommandsOptions> = slashCommands,
	onError: (error: unknown) => void = (error) => {
		throw error;
	}
) {
	let doc: DocumentView;
	let caret = initial.length;
	const events = createEditorEvents();
	const inserted: { markdown: string; placement: 'caret' | 'below' }[] = [];
	const ran: { id: unknown; arg: unknown }[] = [];
	const results: DraftResult[] = [];

	// Empty bytes parse to no block at all, where the editor holds an empty paragraph on an empty
	// line; that paragraph is what the caret sits in.
	const write = (raw: string) =>
		(doc = (raw === ''
			? { children: [{ ...parse('x').children[0], raw: '' }] }
			: parse(raw)) as unknown as DocumentView);
	const raw = () => doc.children[0]?.raw ?? '';
	write(initial);

	const [unit] = installPluginList([plugin], ({ cause }) => onError(cause));
	const editor = {
		// The real rows, so a plugin a test installs lists its entries as in an editor.
		get inserts() {
			return insertRows(everyInstalledPlugin);
		},
		run: (id: unknown, arg?: unknown) => (ran.push({ id, arg }), true)
	} as unknown as Editor;

	/** One paragraph, so its bytes are the document's. */
	function recordingDraft(): PickDraft {
		const writes: { from: number; to: number; text: string }[] = [];
		const queued: typeof inserted = [];
		const draft: PickDraft = {
			stale: false,
			replace({ from, to }, text) {
				writes.push({ from, to, text });
				return draft;
			},
			insert(markdown) {
				queued.push({ markdown, placement: 'caret' });
				return draft;
			},
			insertBelow(markdown) {
				queued.push({ markdown, placement: 'below' });
				return draft;
			},
			data: () => draft,
			now: (at) => at,
			async commit(options) {
				for (const { from, to, text } of writes)
					write(raw().slice(0, from) + text + raw().slice(to));
				if (options?.caret !== undefined) caret = options.caret;
				inserted.push(...queued);
				results.push({ ok: true });
				return { ok: true };
			},
			end() {}
		};
		return draft;
	}

	const menu = createInlineMenuState({
		getDoc: () => doc,
		measured: () => measured(doc),
		getSelection: () => ({
			anchor: { path: [0], offset: caret },
			focus: { path: [0], offset: caret }
		}),
		getMode: () => 'source',
		showsSource: () => false,
		editorFor: () => editor,
		pickDraft: recordingDraft,
		endBurst: () => {},
		events,
		editorId: 'editor-slash',
		reading: fixtureReading(),
		commitRange: async (path, start, end, bytes, caretAfter) => {
			write(raw().slice(0, start) + bytes + raw().slice(end));
			events.emit('edit', typedEdit(path));
			await tick();
			caret = caretAfter;
			events.emit('selectionChange', null);
			await tick();
			return true;
		},
		undoStep: async (_path, _offset, run) => void (await run())
	});
	menu.setMenus((unit?.contribution.menus ?? []).map((m) => ({ plugin: plugin.name, menu: m })));

	let arrived = false;
	return {
		menu,
		unit,
		editor,
		inserted,
		ran,
		results,
		raw,
		caret: () => caret,
		rows: () => menu.getOpen()?.items.map((item) => item.label) ?? [],
		details: () => menu.getOpen()?.items.map((item) => item.detail) ?? [],
		/** One keystroke per character, the way the editor publishes typing. */
		async type(text: string) {
			if (!arrived) {
				arrived = true;
				events.emit('selectionChange', null);
				await tick();
			}
			for (const ch of text) {
				write(raw().slice(0, caret) + ch + raw().slice(caret));
				caret += 1;
				events.emit('edit', typedEdit([0]));
				await tick();
			}
		},
		/** Enter on the open list; false where the list holds no key and Enter would split. */
		async pick(): Promise<boolean> {
			const taken = menu.registry.isOpen && menu.commit();
			for (let i = 0; i < 4; i++) await tick();
			return taken;
		}
	};
}
