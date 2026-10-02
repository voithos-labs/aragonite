/**
 * A `[[toc]]` block whose rendered view lists the document's headings, read straight off
 * `BlockComponentProps.document`: the worked example of using that prop. Recognition starts
 * only once the plugin registers, so without it `[[toc]]` is a plain paragraph.
 */

import {
	definePlugin,
	declarePluginKind,
	declaredPluginKind,
	registerBlockKind,
	registerBlockOpener,
	registerBlockComponent,
	defineBlockComponent,
	simpleLeafClosure,
	OPENER_PRIORITIES,
	type EditorPlugin
} from '$lib/plugin';
import TocBlock from './TocBlock.svelte';
import { MAX_HEADING_DEPTH } from './heading-outline';

export const TOC_BLOCK = 'toc';

const TOC_LINE = '[[toc]]';

export function registerTocBlock(): void {
	const toc = declarePluginKind(TOC_BLOCK);

	// A block that holds its own source, like `fencedCode`: `serialize` re-emits
	// `leadingTrivia + raw`, so a raw taken verbatim from the line round-trips.
	registerBlockKind(toc, {
		label: 'Table of contents',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		// Render-primary like the math blocks: the rendered view gives the caret nowhere to sit
		// at either edge, so both edges take the gap caret.
		gapEdges: 'both',
		conformanceFixture: '[[toc]]\n',
		closure: simpleLeafClosure({
			focus: {
				mode: 'implemented',
				via: 'createEditableLeaf render-primary reveal (source ⇄ folded heading list)'
			},
			selectionPaint: {
				mode: 'implemented',
				via: 'measurePartialRects (raw offsets) while the source is revealed'
			},
			searchPaint: {
				mode: 'implemented',
				via: 'source raw scanned and navigable; while folded, createEditableLeaf covers the rendered block box (opaque single-unit fallback)'
			},
			undo: {
				mode: 'implemented',
				via: 'render-primary — the reveal→edit→blur cycle commits as one undo entry'
			},
			simOracle: { mode: 'implemented', via: 'toc document-prop e2e' }
		})
	});

	registerBlockOpener(toc, {
		// Just below the only built-in that consumes brackets, so `[[toc]]` resolves here
		// whatever that matcher does.
		priority: OPENER_PRIORITIES.linkReferenceDefinition - 5,
		interruptsParagraph: (text) => text === TOC_LINE,
		tryOpen(ctx) {
			// Exact line only, so this process-wide opener never misfires on indented or
			// trailing content in a sibling plugin's document.
			if (ctx.line.text !== TOC_LINE) return null;
			return {
				node: { kind: toc, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw },
				consumed: 1
			};
		}
	});
}

export type MaxHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** The factory argument, which sets every editor's default, and an editor's `{ plugin, options }`
 *  entry, which overrides it. */
export interface TocOptions {
	/** Deepest heading level listed (default 6 = every level). */
	maxDepth?: MaxHeadingLevel;
}

export function tocPlugin(options?: TocOptions): EditorPlugin {
	return definePlugin<Required<TocOptions>>({
		name: 'toc',
		defaults: { maxDepth: options?.maxDepth ?? MAX_HEADING_DEPTH },
		// Anything but a whole number in 1..6 keeps the default rather than listing nothing.
		parseOptions(raw) {
			const maxDepth = (raw as TocOptions | null)?.maxDepth;
			return isMaxHeadingLevel(maxDepth) ? { maxDepth } : {};
		},
		setup() {
			registerTocBlock();
			registerBlockComponent(declaredPluginKind(TOC_BLOCK), defineBlockComponent(TocBlock));
		}
	});
}

function isMaxHeadingLevel(value: unknown): value is MaxHeadingLevel {
	return (
		Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_HEADING_DEPTH
	);
}
