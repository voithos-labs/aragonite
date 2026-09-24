/**
 * The `/` source on a real inline-menu state over one parsed document, typed into a byte at a
 * time. The editor's own entry points are recorded instead of run, so a test reads what a pick
 * asked for: which Markdown, where, and which command.
 */
import { tick } from 'svelte';
import { parse, type DocumentView, type InsertEntry } from '$lib';
import type { EditorContext, InsertMarkdownOptions } from '$lib/plugin';
import { createEditorEvents, type EditEvent } from '$lib/editor-events';
import { createInlineMenuState } from '$lib/inline-menu/inline-menu-state.svelte';
import {
	createSlashSource,
	type SlashCommandsOptions
} from '$lib/plugins/slash-commands/slash-source';

const entry = (id: string, label: string, keywords: string[], markdown: string): InsertEntry => ({
	id,
	label,
	icon: 'plus',
	keywords,
	markdown
});

/** The built-in catalogue's shape, in its order. */
export const CATALOGUE: readonly InsertEntry[] = [
	entry('bullet', 'Bulleted list', ['bullet', 'list'], '- '),
	entry('todo', 'To-do list', ['todo', 'td', 'task', 'list'], '- [ ] '),
	entry('quote', 'Quote', ['blockquote'], '> '),
	entry('divider', 'Divider', ['rule'], '---\n'),
	entry('code', 'Code block', ['fence'], '```\n\n```\n'),
	entry('table', 'Table', ['grid'], '| Column | Column |\n| --- | --- |\n|  |  |\n')
];

const typedEdit = (path: number[]): EditEvent =>
	({ op: 'input', path, detail: { byteLength: 1 }, timestamp: 0 }) as EditEvent;

export function slashHarness(initial: string, options: SlashCommandsOptions = {}) {
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
		commitRange: async (path, start, end, bytes) => {
			write(raw().slice(0, start) + bytes + raw().slice(end));
			events.emit('edit', typedEdit(path));
			await tick();
		},
		landCaret: async (_path, offset) => {
			caret = offset;
			events.emit('selectionChange', null);
			await tick();
			return true;
		},
		joinUndoEntries: (run) => run()
	});

	const editor = {
		editorId: 'editor-slash',
		get document() {
			return doc;
		},
		insertCatalogue: CATALOGUE,
		inlineMenus: menu.registry,
		options,
		insertMarkdown: (markdown: string, opts?: InsertMarkdownOptions) => {
			inserted.push({ markdown, placement: opts?.placement ?? 'caret' });
			return Promise.resolve(true);
		},
		runCommand: (id: string, arg?: unknown) => (ran.push({ id, arg }), true)
	} as unknown as EditorContext;
	menu.registry.addSource(createSlashSource(editor, () => options));

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
			// The pick's write and its caret landing each settle over a tick before `onCommit` runs.
			for (let i = 0; i < 4; i++) await tick();
			return taken;
		}
	};
}
