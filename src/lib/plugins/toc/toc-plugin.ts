/**
 * A `[[toc]]` leaf whose folded view lists the document's headings, read straight off
 * `BlockComponentProps.document` — the reference consumer of that prop. Recognition is
 * gated on registration, so with no plugin loaded `[[toc]]` is a plain paragraph.
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

export const TOC_BLOCK = 'toc';

const TOC_LINE = '[[toc]]';

export function registerTocBlock(): void {
	const toc = declarePluginKind(TOC_BLOCK);

	// A source-holding leaf like `fencedCode`: `serialize` re-emits `leadingTrivia + raw`,
	// so a raw taken verbatim from the line round-trips.
	registerBlockKind(toc, {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
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
		// Gap placement below the only bracket-consuming built-in, so `[[toc]]` resolves here
		// whatever that matcher claims.
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

export interface TocOptions {
	/** Deepest heading level listed (default 6 = every level). */
	maxDepth?: MaxHeadingLevel;
}

export function tocPlugin(options?: TocOptions): EditorPlugin {
	// A definition-time constant extraProp, so a single install fixes the depth process-wide
	// (first-wins install semantics); per-instance depth would need the options channel.
	const maxDepth = options?.maxDepth ?? 6;
	return definePlugin({
		name: 'toc',
		setup() {
			registerTocBlock();
			registerBlockComponent(
				declaredPluginKind(TOC_BLOCK),
				defineBlockComponent(TocBlock, () => ({ maxDepth }))
			);
		}
	});
}
