/**
 * One editor's grammar: the block openers it tries, the lines that end its paragraphs and the
 * block views it draws, built from the built-ins, the plugins its own list names and the block
 * types those plugins contribute. A `parse()` with no editor reads `defaultGrammarView`, the same
 * table over every installed plugin.
 */
import type { AnyBlockKind } from '../core/nodes';
import type { BlockView } from './block-view';
import {
	blockViewFor,
	getBlockKindDescriptor,
	tryGetBlockKindDescriptor,
	type BlockKindDescriptor
} from './block-kind-descriptor';
import {
	byOpenerOrder,
	grammarRecords,
	type BlockOpener,
	type GrammarView,
	type OpenerRecord
} from './block-openers';
import { everyInstalledPlugin, resolvesIn, type PluginActivation } from './plugin-activation';
import { pluginInstallGeneration } from './plugin-install';
import type { InstalledBlock } from './block-type';
import type { BlockCompleter } from './block-completions';

/** GFM syntaxes a host can switch off for one editor (the `syntax` prop); each is on by default. */
export interface SyntaxOptions {
	/** A line indented four columns (or by a tab) opens a code block. */
	indentedCode?: boolean;
	/** A `===` or `---` line under paragraph text makes it a heading. */
	setextHeading?: boolean;
}

export interface EditorGrammar extends GrammarView {
	/** The kind's view, or `undefined` when its plugin isn't on in this editor. */
	blockView(kind: AnyBlockKind): BlockView | undefined;
	/** Never filtered: a block whose plugin is off still needs its descriptor; throws when absent. */
	descriptor(kind: AnyBlockKind): BlockKindDescriptor;
	tryDescriptor(kind: AnyBlockKind): BlockKindDescriptor | undefined;
}

export function createEditorGrammar(
	options: {
		/** The plugins this editor turns on; absent turns on every installed plugin. */
		plugins?: PluginActivation;
		syntax?: SyntaxOptions;
		/** The block types this editor's plugins contribute; a new list after `use`. */
		blocks?: () => readonly InstalledBlock[];
	} = {}
): EditorGrammar {
	const activation = options.plugins ?? everyInstalledPlugin;
	const indentedCode = options.syntax?.indentedCode ?? true;
	// A reparse reads both lists once per block, so they're kept against the registered records, the
	// installed set and the editor's own list, and rebuilt when any of them changes.
	let builtFrom: readonly OpenerRecord[] | null = null;
	let builtAt = -1;
	let builtForList: number | undefined;
	let builtForBlocks: readonly InstalledBlock[] = [];
	let openers: readonly BlockOpener[] = [];
	let interrupts: ((lineText: string) => boolean)[] = [];
	let ownViews = new Map<AnyBlockKind, BlockView>();
	let ownCompleters: readonly BlockCompleter[] = [];
	const refresh = (): void => {
		const records = grammarRecords();
		const generation = pluginInstallGeneration();
		const blocks = options.blocks?.() ?? builtForBlocks;
		if (
			records === builtFrom &&
			generation === builtAt &&
			activation.generation === builtForList &&
			blocks === builtForBlocks
		)
			return;
		builtFrom = records;
		builtAt = generation;
		builtForList = activation.generation;
		builtForBlocks = blocks;
		ownViews = new Map(blocks.map((b) => [b.kind, b.view]));
		ownCompleters = blocks.flatMap((b) => b.completer ?? []);
		const own = blocks.flatMap((b) => (b.opener ? [{ key: b.kind, value: b.opener }] : []));
		// A switched-off syntax leaves the grammar only: a block of that kind still renders.
		const kept = records.filter(
			(r) => resolvesIn(activation, r.owner) && (indentedCode || r.key !== 'indentedCode')
		);
		openers = (own.length ? [...kept, ...own].sort(byOpenerOrder) : kept).map((r) => r.value);
		interrupts = openers.flatMap((opener) => opener.interruptsParagraph || []);
	};
	return {
		setextHeading: options.syntax?.setextHeading ?? true,
		activation,
		orderedOpeners() {
			refresh();
			return openers;
		},
		interruptsParagraph(lineText) {
			refresh();
			return interrupts.some((interrupt) => interrupt(lineText));
		},
		completers() {
			refresh();
			return ownCompleters;
		},
		blockView(kind) {
			refresh();
			return ownViews.get(kind) ?? blockViewFor(kind, activation);
		},
		descriptor: (kind) => getBlockKindDescriptor(kind),
		tryDescriptor: (kind) => tryGetBlockKindDescriptor(kind)
	};
}

/** The grammar of a parse with no editor: every installed plugin's syntax. */
export const defaultGrammarView: EditorGrammar = createEditorGrammar();
