/**
 * How a conformance check reads: the grammar of the editor under test, and every read that would
 * otherwise fall back to the default grammar without saying so. A cell takes one and reads through
 * nothing else, so a plugin value's block types and inlines are read as its own editor reads them.
 */

import type { AnyBlockKind, Document, InlineNode } from '../core/nodes';
import { parse } from '../core/parser';
import { parseInline } from '../core/inline';
import type { BlockKindDescriptor } from '../schema/block-kind-descriptor';
import {
	createEditorGrammar,
	defaultGrammarView,
	type EditorGrammar
} from '../schema/editor-grammar';
import { installBlockTypes } from '../schema/block-type';
import { installInlines } from '../schema/inline-type';
import { createEditorActivation } from '../schema/plugin-activation';
import {
	installPluginList,
	type InstalledPlugin,
	type PluginError,
	type PluginList
} from '../schema/plugin-unit';
import type { PresentationMode } from '../presentation-mode';
import type { Reading } from '../schema/reading';
import { createHeadlessActions, type HeadlessActions } from './headless-actions';
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
	headless(content: Parameters<typeof createHeadlessActions>[0]): HeadlessActions;
	/** Throws unless `doc` matches a fresh parse of its own bytes, kinds and metadata included. */
	converged(doc: Document, label: string): void;
}

export function checkContext(grammar: EditorGrammar): CheckContext {
	const reading: CheckContext['reading'] = (mode) => ({ ...kitReading(mode), grammar });
	return {
		grammar,
		parse: (text) => parse(text, { grammar }),
		parseInline: (raw, start, end) => parseInline(raw, start, end, undefined, grammar),
		reading,
		descriptor: (kind) => grammar.descriptor(kind),
		headless: (content) => createHeadlessActions(content, { reading: reading() }),
		converged(doc, label) {
			const divergence = describeConvergence(doc, grammar);
			if (divergence) throw new Error(`${label}: ${divergence}`);
		}
	};
}

/** The context of a check over plugin values: their block types and inlines installed as one
 *  editor installs them, each problem handed to `report`, and held until `release`. */
export function pluginCheckContext(
	plugins: PluginList,
	report: (error: PluginError) => void
): { context: CheckContext; units: readonly InstalledPlugin[]; release(): void } {
	const units = installPluginList(plugins, report);
	const blocks = installBlockTypes(units, report);
	const inlines = installInlines(units, report);
	const grammar = createEditorGrammar({
		plugins: createEditorActivation(units.map((unit) => unit.name)),
		blocks: () => blocks.blocks,
		inlines: () => inlines.inlines
	});
	const release = (): void => {
		blocks.release();
		inlines.release();
	};
	return { context: checkContext(grammar), units, release };
}

/** The context of a check with no editor: every installed plugin's syntax. */
export const defaultCheckContext: CheckContext = checkContext(defaultGrammarView);
