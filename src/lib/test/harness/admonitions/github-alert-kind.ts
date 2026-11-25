/**
 * Native GitHub alerts as a strip container shaped like a blockquote: the source bytes are
 * kept, never rewritten to `:::note`. The marker lives only in the container's raw and
 * metadata, so `strip(raw)` equals the serialized children. Its own kind rather than a
 * variant of the directive admonition, so kind stability and the line shape stay unambiguous.
 */

import {
	OPENER_PRIORITIES,
	blockquoteExtent,
	declarePluginKind,
	declaredPluginKind,
	headedLines,
	parseContainerBody,
	QUOTE_LINES,
	registerBlockKind,
	setPluginMetadata,
	stripShapedLines,
	type BlockOpenerResult,
	type BlockView,
	type ContainerBodyWrap,
	type CstNode,
	type OpenContext
} from '#lib/plugin.js';
import { matchAlertMarker } from '#packages/admonitions/src/gh-alert.js';
import { GITHUB_ALERT, type GithubAlertMetadata } from './kinds';

/** The `> [!TYPE]` line is the alert's own marker, so a blank line against it separates
 *  rather than becoming a block of its own; nothing closes the alert below. */
const BODY_WRAP: ContainerBodyWrap = { afterOpenerLine: true };

function tryOpen(ctx: OpenContext): BlockOpenerResult | null {
	const alertType = matchAlertMarker(ctx.line.text);
	if (!alertType) return null;

	// The built-in extent scan, not the marker regex, decides whether this line opens a
	// blockquote; backing out on zero lines keeps a no-progress return out of the parse loop.
	const { raw, nextIndex } = blockquoteExtent(ctx.lines, ctx.index, ctx.end, ctx.grammar);
	const consumed = nextIndex - ctx.index;
	if (consumed <= 0) return null;

	// Read through the lines the writer writes, as a fresh parse entry, so the body's own line 0
	// must not read as the document top.
	const lines = ctx.lines.slice(ctx.index + 1, nextIndex);
	const body = parseContainerBody(stripShapedLines(ALERT_LINES, { alertType }, lines), BODY_WRAP, {
		scope: 'fragment',
		grammar: ctx.grammar
	});

	const node: CstNode = {
		kind: declaredPluginKind(GITHUB_ALERT),
		leadingTrivia: ctx.leadingTrivia,
		raw,
		innerPrefix: body.prefix,
		children: body.children,
		innerSuffix: body.suffix
	};
	setPluginMetadata<GithubAlertMetadata>(node, { alertType });
	return { node, consumed };
}

/** The alert's lines: a quote's, under a `> [!TYPE]` head line that holds no child. */
const ALERT_LINES = headedLines<GithubAlertMetadata>({
	...QUOTE_LINES,
	head: {
		match: /^[ \t]*\[!([A-Za-z]+)\][ \t]*$/,
		data: (match) => ({ alertType: match[1] }),
		write: (data) => `[!${data.alertType}]`
	}
});

export function registerGithubAlert(view: BlockView): void {
	const kind = declarePluginKind(GITHUB_ALERT);

	registerBlockKind(kind, {
		view,
		opener: {
			// Below blockquote so the alert form matches first, at a priority no other opener
			// uses, so a bundle installing them all keeps every priority unique (G1.10).
			priority: OPENER_PRIORITIES.blockquote - 5,
			tryOpen,
			interruptsParagraph: (t) => matchAlertMarker(t) !== null
		},
		label: 'Alert',
		// A note reads as part of the text around it, so it shows no drag handle.
		pageRole: 'prose',
		gapEdges: 'none',
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		samples: ['> [!NOTE]\n> Heads up.\n'],
		container: {
			lines: ALERT_LINES,
			merges: { key: 'alertType' },
			// The alert is a blockquote with a marker, so it unwraps as one: lifting the
			// first child out drops the marker and reparses plain.
			unwrapRole: {
				firstChildBackspace: 'lift-first-child-drop-opener',
				middleChildBackspace: 'default-merge'
			},
			// The head line holds no child, so the body's children move under it freely.
			reorderChildren: {}
		}
	});
}
