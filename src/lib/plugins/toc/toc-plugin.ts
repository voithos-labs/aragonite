/**
 * The table-of-contents dogfood: a `[[toc]]` leaf whose folded view lists the
 * document's headings. It exists to validate one thing — `BlockComponentProps.document`
 * is delivered to a block component, live and at any depth — so the component reads
 * the heading list straight off that prop. Dev/e2e harness only.
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
		supportsInline: false
	});

	registerBlockOpener(toc, {
		// `[[toc]]` is bracket-leading; the only bracket-consuming built-in is
		// `linkReferenceDefinition`, which declines it (no `:` after the label). So
		// this is gap placement (rule 2) reasoned off that built-in — priced just
		// below it, which also keeps `[[toc]]` winning were the link-ref matcher ever
		// widened to double brackets. 75 is unshared (harness uses 5/15/25/45/65).
		priority: OPENER_PRIORITIES.linkReferenceDefinition - 5,
		interruptsParagraph: (text) => text === TOC_LINE,
		tryOpen(ctx) {
			// Exact line only — indentation or trailing content declines to a
			// paragraph, so the process-wide opener never misfires in a sibling
			// plugin document.
			if (ctx.line.text !== TOC_LINE) return null;
			return {
				node: { kind: toc, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw },
				nextIndex: ctx.index + 1
			};
		}
	});
}

export function tocPlugin(): EditorPlugin {
	return definePlugin({
		name: 'toc',
		setup() {
			registerTocBlock();
			registerBlockComponent(declaredPluginKind(TOC_BLOCK), defineBlockComponent(TocBlock));
		}
	});
}
