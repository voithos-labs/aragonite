/**
 * How a conformance check reads: the grammar of the editor under test, and every read that would
 * otherwise fall back to the default grammar without saying so. A cell takes one and reads through
 * nothing else, so a plugin value's block types and inlines are read as its own editor reads them.
 * A check over plugin values also gets the editor their `setup` meets, with no editor mounted.
 */

import {
	ALL_BLOCK_KINDS,
	type AnyBlockKind,
	type AnyInlineKind,
	type Document,
	type InlineNode
} from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import { measured } from '../tree-operations/top-level-starts';
import { createMenuPick, type MenuPick } from '../schema/caret-menu';
import { isBuiltinCommandId } from '../schema/commands';
import type { Draft } from '../schema/drafts';
import { parseInline } from '../core/inline';
import { resolvedInlineContent } from '../core/inline/inline-cache';
import type { BlockKindDescriptor } from '../schema/block-kind-descriptor';
import {
	createEditorGrammar,
	defaultGrammarView,
	type EditorGrammar
} from '../schema/editor-grammar';
import { createEditorActivation, type PluginActivation } from '../schema/plugin-activation';
import type { InstalledInline } from '../schema/inline-type';
import { listGrammar } from '../schema/own-syntax';
import type { EditorContributions } from '../schema/editor-contributions';
import type { Editor, InstalledPlugin, PluginError, PluginList } from '../schema/plugin-unit';
import type { View } from '../schema/view';
import type { Block } from '../schema/doc-view';
import type { Command } from '../schema/plugin-command';
import { modeOf, type PresentationMode } from '../presentation-mode';
import type { Reading } from '../schema/reading';
import { createDocumentRead, type DocumentRead } from '../editor-actions/commit/document-read';
import { createDraftRegistry } from '../editor-actions/commit/draft-registry.svelte';
import { startsAlone } from '../editor-actions/commit/reading-write-gate';
import { createUndoController } from '../editor-actions/commit/undo-controller';
import {
	createHeadlessActions,
	stubBlockComponent,
	type HeadlessActions,
	type HeadlessActionsOptions
} from './headless-actions';
import { kitReading } from './kit-reading';
import { describeConvergence } from './parse-convergence';

/** What a cell reads through; build one per run with {@link checkContext}. */
export interface CheckContext {
	readonly grammar: EditorGrammar;
	parse(text: string): Document;
	parseInline(raw: string, start: number, end: number): InlineNode[];
	/** A block's inline content as the editor reads it; empty for a block whose text isn't inline. */
	inline(node: NodeView): readonly InlineNode[];
	/** The same reading with no plugin's syntax: what the editor reads on its own. */
	builtIns(): CheckContext;
	/** Every sample the editor's own block types list. */
	builtInSamples(): readonly string[];
	/** The reading an editor part built without an editor takes, source mode unless told. */
	reading(mode?: () => PresentationMode): Reading;
	descriptor(kind: AnyBlockKind): BlockKindDescriptor;
	/** The headless edit actions over `content`, reading as the editor under test. */
	headless(
		content: Parameters<typeof createHeadlessActions>[0],
		options?: Omit<HeadlessActionsOptions, 'reading'>
	): HeadlessActions;
	/** Throws unless `doc` matches a fresh parse of its own bytes, kinds and metadata included. */
	converged(doc: Document, label: string): void;
}

export function checkContext(grammar: EditorGrammar): CheckContext {
	const reading: CheckContext['reading'] = (mode) => ({ ...kitReading(mode), grammar });
	const read = (text: string) => parse(text, { grammar });
	let builtIns: CheckContext | undefined;
	return {
		grammar,
		parse: read,
		parseInline: (raw, start, end) => parseInline(raw, start, end, undefined, grammar),
		inline: (node) => resolvedInlineContent(node, reading()),
		builtIns: () =>
			(builtIns ??= checkContext(createEditorGrammar({ plugins: createEditorActivation([]) }))),
		builtInSamples: () =>
			ALL_BLOCK_KINDS.flatMap((kind) => grammar.tryDescriptor(kind)?.samples ?? []),
		reading,
		descriptor: (kind) => grammar.descriptor(kind),
		headless: (content, options) =>
			createHeadlessActions(typeof content === 'string' ? read(content) : content, {
				...options,
				reading: reading()
			}),
		converged(doc, label) {
			const divergence = describeConvergence(doc, grammar);
			if (divergence) throw new Error(`${label}: ${divergence}`);
		}
	};
}

/** A check over plugin values: their context, the plugins an editor would keep, and the editor a
 *  `setup` meets over `source`. Hold it until `release`. */
export interface PluginCheckRun {
	readonly context: CheckContext;
	readonly units: readonly InstalledPlugin[];
	/** The block types the install kept, by kind, in list order. */
	readonly kinds: readonly AnyBlockKind[];
	/** The inline constructs it kept, by kind. */
	readonly inlines: ReadonlyMap<AnyInlineKind, InstalledInline>;
	readonly contributions: EditorContributions;
	editor(source: string): Editor;
	/** The editor over `source`, with what a row reads of what the plugin did to it. */
	stage(source: string): Stage;
	/** The list's own syntax read with the plugins `activation` turns on, `setup` plugins among them. */
	readingWith(activation: PluginActivation): CheckContext;
	release(): void;
}

/** The editor a row drives, and what a mounted editor would have shown of the plugin's run. */
export interface Stage {
	readonly editor: Editor;
	/** Each write the plugin made or started, in order: a commit, an insert, a built-in command. */
	readonly writes: readonly string[];
	/** Each member that answers only on screen the plugin asked, in order. */
	readonly screen: readonly string[];
	/** Whether a write the plugin started through the editor is still going. */
	busy(): boolean;
	/** Settles once no write the plugin started through the editor is still going. */
	idle(): Promise<void>;
	/** Puts the caret at byte `at`. */
	caret(at: number): void;
	/** Loads `text` as a host's `load` does: every draft opened before it is refused. */
	swap(text: string): void;
	/** `swap`, and a fresh record of writes and screen asks, for the next row. */
	load(text: string): void;
	source(): string;
	/** The document as the editor holds it now. */
	document(): DocumentView;
	/** `node`, at `path` in that document, as a plugin reads it. */
	blockOf(node: NodeView, path: readonly number[]): Block;
	/** The pick of a menu whose trigger and `query` start the document, as a mounted editor hands
	 *  one to a menu's `pick`. */
	pick(trigger: string, query: string): MenuPick;
}

/** Installs `plugins` the way an editor's list does, in its order, each problem handed to
 *  `report`. */
export function pluginCheckContext(
	plugins: PluginList,
	report: (error: PluginError) => void
): PluginCheckRun {
	let current: (Stage & { read: DocumentRead }) | undefined;
	const list = listGrammar(plugins, report, {
		editorFor: () => current?.editor,
		blockOf: (node, path) => current!.read.blockOf(node, path),
		clipboardBlocks: (clip) => clipboardRead(clip, list.units, context.reading()).blockOf
	});
	const context = checkContext(list.grammar);
	const stage = (source: string) =>
		(current = standIn(context, source, list.units, list.contributions));
	return {
		context,
		units: list.units,
		kinds: list.blocks.map((block) => block.kind),
		inlines: list.inlines,
		contributions: list.contributions,
		editor: (source) => stage(source).editor,
		stage,
		readingWith: (activation) =>
			checkContext(
				createEditorGrammar({
					plugins: activation,
					blocks: () => list.blocks,
					inlines: () => list.inlines
				})
			),
		release: list.release
	};
}

/** The context of a check with no editor: every installed plugin's syntax. */
export const defaultCheckContext: CheckContext = checkContext(defaultGrammarView);

/* -------------------------------------------------------------------------- */
/*                     The editor a check hands a plugin                      */
/* -------------------------------------------------------------------------- */

/** Answers as an editor's view does for a block off screen, which a plugin already has to take. */
const OFF_SCREEN: View = {
	boxOf: () => null,
	boxesOf: () => [],
	caretBox: () => null,
	posAt: () => null,
	reveal: async () => false,
	overlay: () => () => {}
};

/** `answer`, noting `member` in `screen` each time it's asked. */
function screened<A extends unknown[], R>(
	screen: string[],
	member: string,
	answer: (...args: A) => R
): (...args: A) => R {
	return (...args) => (screen.push(member), Reflect.apply(answer, undefined, args) as R);
}

/** A built-in type is named by its kind, which is all `is` compares. */
const typeIn = (units: readonly InstalledPlugin[], kind: string) =>
	units.flatMap((unit) => unit.contribution.blocks ?? []).find((type) => type.name === kind) ?? {
		name: kind,
		label: kind
	};

/** `clip`, a clipboard read as blocks, as a rewrite reads its blocks. */
function clipboardRead(
	clip: DocumentView,
	units: readonly InstalledPlugin[],
	reading: Reading
): DocumentRead {
	const of = measured(clip);
	return createDocumentRead({
		getDoc: () => clip,
		measured: () => of,
		typeOf: (kind) => typeIn(units, kind),
		reading,
		version: () => 0,
		source: () => serialize(clip)
	});
}

/** `source` read as `context` reads it, with real drafts and commands; nothing is on screen,
 *  nothing fires, and nothing opens or selects. */
function standIn(
	context: CheckContext,
	source: string,
	units: readonly InstalledPlugin[],
	contributions: EditorContributions
): Stage & { read: DocumentRead } {
	let version = 0;
	const headless = context.headless(source, { bumpContentVersion: () => version++ });
	const { deps } = headless;
	const controller = createUndoController(deps);
	const writes: string[] = [];
	const screen: string[] = [];
	const going = new Set<Promise<unknown>>();
	const track = <T>(write: Promise<T>): Promise<T> => {
		going.add(write);
		void write.finally(() => going.delete(write)).catch(() => {});
		return write;
	};
	const read = createDocumentRead({
		getDoc: () => deps.doc,
		measured: () => deps.bytes.measured(),
		typeOf: (kind) => typeIn(units, kind),
		reading: deps.reading,
		version: () => version,
		source: () => deps.bytes.source()
	});
	const drafts = createDraftRegistry({
		stamps: deps.stamps,
		starts: deps.starts,
		events: headless.events,
		doc: () => deps.doc,
		measured: () => deps.bytes.measured(),
		source: () => deps.bytes.source(),
		isReading: () => false,
		isOn: () => true,
		grammar: context.grammar,
		writes: () => ({
			commitSource: (splice) => (writes.push('a commit'), controller.commitSource(splice)),
			undoStep: (seed, run) => controller.undoStep(seed, run),
			insert: async (markdown) => (writes.push(`an insert of ${JSON.stringify(markdown)}`), false)
		})
	});
	// A draft's commit is a write the plugin started, still going until it settles.
	const tracked = <D extends Draft>(draft: D): D => {
		const { commit } = draft;
		draft.commit = (options) => track(commit.call(draft, options));
		return draft;
	};
	const asked = <A extends unknown[], R>(member: string, answer: (...args: A) => R) =>
		screened(screen, member, answer);
	let caret: number | null = null;
	let swaps = 0;
	const entryOf = (command: Command<unknown> | string) => contributions.command(command);
	const editor: Editor = {
		plugins: units.map((unit) => unit.name),
		mode: modeOf('source'),
		theme: 'light',
		inserts: contributions.inserts,
		get doc() {
			return read.doc();
		},
		get selection() {
			if (caret === null) return null;
			const at = caret;
			return {
				anchor: at,
				head: at,
				from: at,
				to: at,
				empty: true,
				block: read.blockAt(at),
				cells: null
			};
		},
		view: {
			boxOf: asked('view.boxOf', OFF_SCREEN.boxOf),
			boxesOf: asked('view.boxesOf', OFF_SCREEN.boxesOf),
			caretBox: asked('view.caretBox', OFF_SCREEN.caretBox),
			posAt: asked('view.posAt', OFF_SCREEN.posAt),
			reveal: asked('view.reveal', OFF_SCREEN.reveal),
			overlay: asked('view.overlay', OFF_SCREEN.overlay)
		},
		on: () => () => {},
		run: (command: Command<unknown> | string, arg?: unknown) => {
			const entry = entryOf(command);
			if (entry) return contributions.run(entry, arg);
			// A built-in runs on the block holding the caret, which only a drawn block can do: the
			// run is heard as the write it would make, and answers as it would at a paragraph.
			if (typeof command !== 'string' || !isBuiltinCommandId(command)) return false;
			writes.push(`a run of ${command}`);
			return true;
		},
		can: (command: Command<unknown> | string, arg?: unknown) => {
			const entry = entryOf(command);
			if (entry) return contributions.can(entry, arg);
			return typeof command === 'string' && isBuiltinCommandId(command);
		},
		claims: () => false,
		openMenu: asked('openMenu', () => false),
		openRows: asked('openRows', () => ({ isOpen: false, close() {} })),
		edit: () => tracked(drafts.edit()),
		blockAt: (at) => read.blockAt(at),
		select: asked('select', async () => false),
		repaint: () => {}
	};
	return {
		editor,
		read,
		writes,
		screen,
		busy: () => going.size > 0,
		async idle() {
			while (going.size > 0) await Promise.allSettled([...going]);
		},
		caret: (at) => void (caret = at),
		swap(text) {
			if (!startsAlone({ starts: deps.starts, events: headless.events })) return;
			deps.stamps.retire();
			drafts.closeAll('document-swap');
			const next = context.parse(text);
			deps.starts.duringWrite(() => {
				deps.setDoc(next);
				return { touched: null };
			});
			// Every block of the new note is mounted under an id no block had, as a swap's list is.
			swaps++;
			deps.setBlockIds(next.children.map((_, i) => `note-${swaps}-${i}`));
			deps.setBlockRefs(next.children.map(() => stubBlockComponent()));
			caret = null;
		},
		load(text) {
			this.swap(text);
			writes.length = 0;
			screen.length = 0;
		},
		source: () => deps.bytes.source(),
		document: () => deps.doc,
		blockOf: (node, path) => read.blockOf(node, path),
		pick(trigger, query) {
			const range = { from: 0, to: trigger.length + query.length };
			const typed = range.to - range.from;
			const pick = createMenuPick({
				draft: tracked(drafts.edit(undefined, range)),
				trigger,
				query,
				range,
				removeQuery: async (at) =>
					at !== null &&
					(
						await tracked(drafts.edit())
							.replace({ from: at, to: at + typed }, '')
							.commit()
					).ok,
				editor: () => editor,
				undoStep: (run) => run().then(() => {})
			});
			for (const name of ['write', 'insertBlock', 'run'] as const) {
				const own = pick[name] as (...args: unknown[]) => Promise<unknown>;
				(pick as unknown as Record<string, unknown>)[name] = (...args: unknown[]) =>
					track(own.apply(pick, args));
			}
			return pick;
		}
	};
}
