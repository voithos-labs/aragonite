/**
 * A test kind that only opens at one position: `---` front matter, recognized at the top of the
 * document and nowhere else. No shipped kind has this shape, so the suites need one that does.
 */

import { joinRaw } from '$lib/core/parser';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import {
	registerBlockOpener,
	type BlockOpenerResult,
	type OpenContext
} from '$lib/schema/block-openers';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { testClosure } from './closure';

export const FRONT_MATTER = '---\ntitle: x\n---\n';

type PluginKind = ReturnType<typeof declarePluginKind>;

/**
 * The supported check. Written as `!== false` rather than a plain truth test so the opener still
 * fires where the field is absent, which is what makes the regression test fail rather than pass
 * for the wrong reason.
 */
function atDocumentTop(ctx: OpenContext): boolean {
	return (
		ctx.isDocumentParse !== false && ctx.index === 0 && ctx.depth === 0 && ctx.leadingTrivia === ''
	);
}

function openFrontMatter(ctx: OpenContext, kind: PluginKind): BlockOpenerResult | null {
	if (!atDocumentTop(ctx) || ctx.line.text !== '---') return null;
	for (let i = ctx.index + 1; i < ctx.end; i++) {
		if (ctx.lines[i].text !== '---') continue;
		return {
			node: { kind, leadingTrivia: ctx.leadingTrivia, raw: joinRaw(ctx.lines, ctx.index, i + 1) },
			consumed: i - ctx.index + 1
		};
	}
	return null;
}

/** Register the kind and its opener into the freshly-reset registries; returns the kind. */
export function registerDocumentTopKind(): PluginKind {
	const kind = declarePluginKind('test-front-matter');
	registerBlockKind(kind, {
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: false,
		supportsInline: false,
		closure: testClosure
	});
	registerBlockOpener(kind, {
		priority: 1,
		interruptsParagraph: false,
		tryOpen: (ctx) => openFrontMatter(ctx, kind)
	});
	return kind;
}
