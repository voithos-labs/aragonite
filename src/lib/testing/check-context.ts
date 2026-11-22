/**
 * How a conformance check reads: the grammar of the editor under test, and every read that would
 * otherwise fall back to the default grammar without saying so. A cell takes one and reads through
 * nothing else, so a plugin value's block types and inlines are read as its own editor reads them.
 * A check over plugin values also gets the editor their `setup` meets, with no editor mounted.
 */

import type { AnyBlockKind, Document, InlineNode } from '../core/nodes';
import { parse } from '../core/parser';
import { parseInline } from '../core/inline';
import type { BlockKindDescriptor } from '../schema/block-kind-descriptor';
import { defaultGrammarView, type EditorGrammar } from '../schema/editor-grammar';
import { listGrammar } from '../schema/own-syntax';
import type { EditorContributions } from '../schema/editor-contributions';
import type { Editor, InstalledPlugin, PluginError, PluginList } from '../schema/plugin-unit';
import type { View } from '../schema/view';
import type { Command } from '../schema/plugin-command';
import { modeOf, type PresentationMode } from '../presentation-mode';
import type { Reading } from '../schema/reading';
import { createDocumentRead, type DocumentRead } from '../editor-actions/commit/document-read';
import { createDraftRegistry } from '../editor-actions/commit/draft-registry.svelte';
import { createUndoController } from '../editor-actions/commit/undo-controller';
import {
	createHeadlessActions,
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
	return {
		grammar,
		parse: read,
		parseInline: (raw, start, end) => parseInline(raw, start, end, undefined, grammar),
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
	editor(source: string): Editor;
	release(): void;
}

/** Installs `plugins` the way an editor's list does, in its order, each problem handed to
 *  `report`. */
export function pluginCheckContext(
	plugins: PluginList,
	report: (error: PluginError) => void
): PluginCheckRun {
	let current: StandIn | undefined;
	const list = listGrammar(plugins, report, {
		editorFor: () => current?.editor,
		blockOf: (node, path) => current!.read.blockOf(node, path)
	});
	const context = checkContext(list.grammar);
	return {
		context,
		units: list.units,
		kinds: list.blocks.map((block) => block.kind),
		editor(source) {
			current = standIn(context, source, list.units, list.contributions);
			return current.editor;
		},
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

interface StandIn {
	editor: Editor;
	read: DocumentRead;
}

/** `source` read as `context` reads it, with real drafts and commands; nothing is on screen,
 *  nothing fires, and nothing opens or selects. */
function standIn(
	context: CheckContext,
	source: string,
	units: readonly InstalledPlugin[],
	contributions: EditorContributions
): StandIn {
	let version = 0;
	const headless = context.headless(source, { bumpContentVersion: () => version++ });
	const { deps } = headless;
	const controller = createUndoController(deps);
	const read = createDocumentRead({
		getDoc: () => deps.doc,
		measured: () => deps.bytes.measured(),
		// A built-in type is named by its kind, which is all `is` compares.
		typeOf: (kind) =>
			units
				.flatMap((unit) => unit.contribution.blocks ?? [])
				.find((type) => type.name === kind) ?? {
				name: kind,
				label: kind
			},
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
			commitSource: controller.commitSource,
			undoStep: (seed, run) => controller.undoStep(seed, run),
			insert: async () => false
		})
	});
	const entryOf = (command: Command<unknown> | string) => contributions.command(command);
	const editor: Editor = {
		plugins: units.map((unit) => unit.name),
		mode: modeOf('source'),
		theme: 'light',
		inserts: contributions.inserts,
		get doc() {
			return read.doc();
		},
		selection: null,
		view: OFF_SCREEN,
		on: () => () => {},
		run: (command: Command<unknown> | string, arg?: unknown) => {
			const entry = entryOf(command);
			return !!entry && contributions.run(entry, arg);
		},
		can: (command: Command<unknown> | string, arg?: unknown) => {
			const entry = entryOf(command);
			return !!entry && contributions.can(entry, arg);
		},
		claims: () => false,
		openMenu: () => false,
		openRows: () => ({ isOpen: false, close() {} }),
		edit: () => drafts.edit(),
		blockAt: (at) => read.blockAt(at),
		select: async () => false,
		repaint: () => {}
	};
	return { editor, read };
}
