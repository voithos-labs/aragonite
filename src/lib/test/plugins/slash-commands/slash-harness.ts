/**
 * The `/` source on a real inline-menu state over one parsed document, typed into a byte at a
 * time. The editor's own entry points are recorded instead of run, so a test reads what a pick
 * asked for: which Markdown, where, and which command. `slashPluginHarness` lists through the
 * installed plugin and its editor context instead, so the options are the ones an editor merges.
 */
import { tick } from 'svelte';
import { installPlugins, parse, type DocumentView, type EditorEvents } from '$lib';
import type {
	EditorContext,
	EditorPluginEntry,
	InlineMenuRegistry,
	InsertMarkdownOptions
} from '$lib/plugin';
import { createEditorEvents, type EditEvent } from '$lib/editor-events';
import { createInlineMenuState } from '$lib/inline-menu/inline-menu-state.svelte';
import { insertCatalogue } from '$lib/schema/insert-catalogue';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import {
	createSlashSource,
	type SlashCommandsOptions
} from '$lib/plugins/slash-commands/slash-source';
import { createEditorPluginContexts } from '$lib/schema/plugin-editor-context';
import { normalizePluginEntries } from '$lib/schema/plugin-install';
import { fixtureReading } from '../../harness/fixture-grammar';
import { pluginContextDeps } from '../../support/plugin-context-deps';

const typedEdit = (path: number[]): EditEvent =>
	({ op: 'input', path, detail: { byteLength: 1 }, timestamp: 0 }) as EditEvent;

/** What a harness hands the code that attaches the `/` source. */
interface HarnessHost {
	getDoc: () => DocumentView;
	events: EditorEvents;
	inlineMenus: InlineMenuRegistry;
	insertMarkdown: (markdown: string, opts?: InsertMarkdownOptions) => Promise<boolean>;
	runCommand: (id: string, arg?: unknown) => boolean;
}

export function slashHarness(initial: string, options: SlashCommandsOptions = {}) {
	return harness(initial, (host) => {
		const editor = {
			editorId: 'editor-slash',
			get document() {
				return host.getDoc();
			},
			// The real catalogue, so a plugin a test installs lists its entries as in an editor.
			get insertCatalogue() {
				return insertCatalogue(everyInstalledPlugin);
			},
			inlineMenus: host.inlineMenus,
			options,
			insertMarkdown: host.insertMarkdown,
			runCommand: host.runCommand
		} as unknown as EditorContext<SlashCommandsOptions>;
		host.inlineMenus.addSource(createSlashSource(editor));
		return editor;
	});
}

/** Installs the entry's plugin; reset the plugin platform around each case. */
export function slashPluginHarness(
	initial: string,
	entry: EditorPluginEntry,
	onError: (error: unknown) => void = (error) => {
		throw error;
	}
) {
	return harness(initial, (host) => {
		const { plugins, optionsByName } = normalizePluginEntries([entry]);
		installPlugins(plugins);
		const contexts = createEditorPluginContexts({
			...pluginContextDeps(),
			...host,
			optionsFor: (name) => optionsByName.get(name)
		});
		contexts.attachAll(({ error }) => onError(error));
		return contexts.get(plugins[0].name)!;
	});
}

function harness(initial: string, attach: (host: HarnessHost) => EditorContext) {
	let doc: DocumentView;
	let caret = initial.length;
	const events = createEditorEvents();
	const inserted: { markdown: string; placement: InsertMarkdownOptions['placement'] }[] = [];
	const ran: { id: string; arg: unknown }[] = [];

	// Empty bytes parse to no block at all, where the editor holds an empty paragraph on an empty
	// line; that paragraph is what the caret sits in.
	const write = (raw: string) =>
		(doc = (raw === ''
			? { children: [{ ...parse('x').children[0], raw: '' }] }
			: parse(raw)) as unknown as DocumentView);
	const raw = () => doc.children[0]?.raw ?? '';
	write(initial);

	const menu = createInlineMenuState({
		getDoc: () => doc,
		getSelection: () => ({
			anchor: { path: [0], offset: caret },
			focus: { path: [0], offset: caret }
		}),
		getMode: () => 'source',
		events,
		editorId: 'editor-slash',
		reading: fixtureReading(),
		commitRange: async (path, start, end, bytes) => {
			write(raw().slice(0, start) + bytes + raw().slice(end));
			events.emit('edit', typedEdit(path));
			await tick();
			return true;
		},
		landCaret: async (_path, offset) => {
			caret = offset;
			events.emit('selectionChange', null);
			await tick();
			return true;
		},
		undoStep: async (_path, _offset, run) => void (await run())
	});

	const editor = attach({
		getDoc: () => doc,
		events,
		inlineMenus: menu.registry,
		insertMarkdown: (markdown, opts) => {
			inserted.push({ markdown, placement: opts?.placement ?? 'caret' });
			return Promise.resolve(true);
		},
		runCommand: (id, arg) => (ran.push({ id, arg }), true)
	});

	let arrived = false;
	return {
		menu,
		editor,
		inserted,
		ran,
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
			// The pick's write and its caret landing each take a tick before `onCommit` runs.
			for (let i = 0; i < 4; i++) await tick();
			return taken;
		}
	};
}
