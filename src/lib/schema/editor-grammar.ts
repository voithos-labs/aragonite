/**
 * One editor's grammar: the block openers it tries, the lines that end its paragraphs and the
 * block views it draws, built from the built-ins and the plugins its own list names. A `parse()`
 * with no editor reads `defaultGrammarView`, the same table over every installed plugin.
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
	grammarRecords,
	type BlockOpener,
	type GrammarView,
	type OpenerRecord
} from './block-openers';
import { everyInstalledPlugin, resolvesIn, type PluginActivation } from './plugin-activation';
import { pluginInstallGeneration } from './plugin-install';
import { pluginKindOwner } from './plugin-kind';

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

/** `false` leaves a plugin kind out of one editor; built-ins are switched only by `syntax`. */
export type KindEnablement = (kind: AnyBlockKind) => boolean;

export function kindEnablementFor(activation: PluginActivation): KindEnablement {
	return (kind) => resolvesIn(activation, pluginKindOwner(kind));
}

export function createEditorGrammar(
	options: {
		/** The plugins this editor turns on; absent turns on every installed plugin. */
		plugins?: PluginActivation;
		syntax?: SyntaxOptions;
	} = {}
): EditorGrammar {
	const activation = options.plugins ?? everyInstalledPlugin;
	const indentedCode = options.syntax?.indentedCode ?? true;
	const enabled = kindEnablementFor(activation);
	// A reparse reads both lists once per block, so they're kept against the registered records, the
	// installed set and the editor's own list, and rebuilt when any of them changes.
	let builtFrom: readonly OpenerRecord[] | null = null;
	let builtAt = -1;
	let builtForList: number | undefined;
	let openers: readonly BlockOpener[] = [];
	let interrupts: ((lineText: string) => boolean)[] = [];
	const refresh = (): void => {
		const records = grammarRecords();
		const generation = pluginInstallGeneration();
		if (records === builtFrom && generation === builtAt && activation.generation === builtForList)
			return;
		builtFrom = records;
		builtAt = generation;
		builtForList = activation.generation;
		// A switched-off syntax leaves the grammar only: a block of that kind still renders.
		const kept = records.filter(
			(r) =>
				resolvesIn(activation, r.owner) &&
				enabled(r.key) &&
				(indentedCode || r.key !== 'indentedCode')
		);
		openers = kept.map((r) => r.value);
		interrupts = kept.flatMap((r) => r.value.interruptsParagraph || []);
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
		blockView: (kind) => (enabled(kind) ? blockViewFor(kind, activation) : undefined),
		descriptor: (kind) => getBlockKindDescriptor(kind),
		tryDescriptor: (kind) => tryGetBlockKindDescriptor(kind)
	};
}

/** The grammar of a parse with no editor: every installed plugin's syntax. */
export const defaultGrammarView: EditorGrammar = createEditorGrammar();
