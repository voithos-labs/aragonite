/**
 * A position-scoped test kind — `---` front matter that opens only at the document top.
 * The exemplar no shipped kind provides, and the shape issue #52 was found with.
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
 * The sanctioned gate. Written `!== false` rather than as a truth test so it still opens
 * where the field is absent: on pre-fix code the regression pins red instead of passing
 * vacuously.
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
