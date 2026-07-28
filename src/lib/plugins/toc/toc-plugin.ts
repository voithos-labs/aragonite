/**
 * The table-of-contents dogfood: a `[[toc]]` leaf whose folded view lists the
 * document's headings. It exists to validate one thing — `BlockComponentProps.document`
 * is delivered to a block component, live and at any depth — so the component reads
 * the heading list straight off that prop. Ships as the `aragonite/plugins/toc`
 * bundled plugin.
 *
 * Recognition is gated on registration: with no plugin loaded, `[[toc]]` is a plain
 * paragraph, so parsing stays byte-identical to bare GFM.
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

	// A source-holding leaf like `fencedCode`: no children, `serialize` re-emits
	// `leadingTrivia + raw`, so a `raw` taken verbatim from the line round-trips.
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
		// `[[toc]]` is bracket-leading; the only bracket-consuming built-in is
		// `linkReferenceDefinition`, which declines it (no `:` after the label). So
		// this is gap placement (rule 2) reasoned off that built-in — priced just
		// below it, which also keeps `[[toc]]` winning were the link-ref matcher ever
		// widened to double brackets.
		priority: OPENER_PRIORITIES.linkReferenceDefinition - 5,
		interruptsParagraph: (text) => text === TOC_LINE,
		tryOpen(ctx) {
			// Exact line only — indentation or trailing content declines to a
			// paragraph, so the process-wide opener never misfires in a sibling
			// plugin document.
			if (ctx.line.text !== TOC_LINE) return null;
			return {
				node: { kind: toc, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw },
				consumed: 1
			};
		}
	});
}

/** Heading levels shown in the outline; entries deeper than this are filtered out. */
export type MaxHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface TocOptions {
	/** Deepest heading level listed (default 6 = every level). */
	maxDepth?: MaxHeadingLevel;
}

export function tocPlugin(options?: TocOptions): EditorPlugin {
	// Definition-time option: the register-once component entry carries it as a
	// constant extraProp, so a single install fixes the depth process-wide (the
	// documented first-wins install semantics). Per-instance depth would need the
	// EditorContext options channel, which this bundled plugin deliberately skips.
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
