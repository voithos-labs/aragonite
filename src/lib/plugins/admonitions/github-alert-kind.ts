/**
 * Native GitHub alerts as a strip container in the blockquote mold, bytes kept and
 * never rewritten to `:::note`. The marker lives only in the container's raw +
 * metadata, so `strip(raw)` equals the serialized children. A separate kind rather
 * than a directive-admonition variant, so kind stability and rebuildRaw stay
 * unambiguous per kind (the ATX/setext heading precedent).
 */

import {
	OPENER_PRIORITIES,
	blockquoteExtent,
	containerClosure,
	declarePluginKind,
	declaredPluginKind,
	defineBlockComponent,
	getPluginMetadata,
	parseContainerBody,
	registerBlockComponent,
	registerBlockKind,
	registerBlockOpener,
	serializeChildren,
	setPluginMetadata,
	type BlockOpenerResult,
	type ContainerBodyWrap,
	type CstNode,
	type OpenContext,
	type ParsedLine
} from '$lib/plugin';
import { matchAlertMarker, stripQuoteMarker } from './gh-alert';
import { GITHUB_ALERT, type GithubAlertMetadata } from './kinds';
import AdmonitionBlock from './AdmonitionBlock.svelte';

/** The `> [!TYPE]` marker line is the alert's own chrome, so a blank against it separates
 *  rather than materializing; nothing closes the alert below. */
const BODY_WRAP: ContainerBodyWrap = { afterOpenerLine: true };

function tryOpen(ctx: OpenContext): BlockOpenerResult | null {
	const alertType = matchAlertMarker(ctx.line.text);
	if (!alertType) return null;

	// The built-in extent scan, not the marker regex, is the authority on whether this line
	// opens a blockquote: declining on a zero-line claim keeps a marker-rule drift from
	// reaching the parse loop as a non-advancing return.
	const { raw, nextIndex } = blockquoteExtent(ctx.lines, ctx.index, ctx.end);
	const consumed = nextIndex - ctx.index;
	if (consumed <= 0) return null;

	// A fresh parse entry, so the body's own line 0 must not read as the document top.
	const body = parseContainerBody(stripBody(ctx.lines, ctx.index + 1, nextIndex), BODY_WRAP, {
		scope: 'fragment'
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

function stripBody(lines: ParsedLine[], start: number, end: number): string {
	let out = '';
	for (let i = start; i < end; i++) out += stripQuoteMarker(lines[i].text) + lines[i].lineEnding;
	return out;
}

/** Splitting the body on `\n` keeps a `\r` at each segment's tail, so CRLF rides through;
 *  the marker's own ending is read off the current raw. */
export function rebuildGithubAlertRaw(node: CstNode): void {
	const alertType = getPluginMetadata<GithubAlertMetadata>(node)?.alertType ?? 'NOTE';
	const marker = `> [!${alertType}]`;
	const body =
		(node.innerPrefix ?? '') + serializeChildren(node.children ?? []) + (node.innerSuffix ?? '');

	if (body === '') {
		node.raw = node.raw.endsWith('\n') ? marker + firstLineEnding(node.raw) : marker;
		return;
	}
	node.raw = marker + firstLineEnding(node.raw) + prefixQuoteLines(body);
}

/** Not `core/lines.ts`'s `trailingLineEnding`: on a mixed-ending block that reader would
 *  rewrite the marker's CRLF to LF. Rebuilding threads each line's own ending. */
function firstLineEnding(raw: string): string {
	const nl = raw.indexOf('\n');
	if (nl < 0) return '\n';
	return raw[nl - 1] === '\r' ? '\r\n' : '\n';
}

function prefixQuoteLines(body: string): string {
	const lines = body.split('\n');
	return lines
		.map((line, i) => {
			if (i === lines.length - 1 && line === '') return '';
			if (line === '' || line === '\r') return `>${line}`;
			return `> ${line}`;
		})
		.join('\n');
}

export function registerGithubAlert(): void {
	const kind = declarePluginKind(GITHUB_ALERT);

	registerBlockOpener(kind, {
		// Below blockquote so the alert form is claimed first; its own slot, distinct
		// from every other opener, so the co-installed bundle stays unique (G1.10).
		priority: OPENER_PRIORITIES.blockquote - 5,
		tryOpen,
		interruptsParagraph: (t) => matchAlertMarker(t) !== null
	});

	registerBlockKind(kind, {
		gapEdges: 'none',
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		conformanceFixture: '> [!NOTE]\n> Heads up.\n',
		container: {
			contract: 'strip',
			rebuildRaw: rebuildGithubAlertRaw,
			bodyWrap: BODY_WRAP,
			// The alert is a blockquote with a marker, so it unwraps as one: lifting the
			// first child out drops the marker and reparses plain.
			unwrapRole: {
				firstChildBackspace: 'lift-first-child-drop-opener',
				middleChildBackspace: 'default-merge'
			},
			// The marker is position-independent, so rebuildRaw re-emits it after a move.
			reorderChildren: {}
		},
		closure: containerClosure({
			roundTripVia:
				'container contract=strip — rebuildGithubAlertRaw re-emits the > [!TYPE] marker (casing from metadata) + > -prefixed body, CRLF threaded',
			focus: {
				mode: 'implemented',
				via: 'focus walks into the first body child via createContainerBlock'
			},
			mergeBackspace: {
				mode: 'implemented',
				via: 'mergeRole=container + unwrapRole (lift-first-child-drop-opener; default-merge) — Backspace at the body start lifts the first child out and drops the marker, leaving a plain blockquote'
			},
			undo: { mode: 'inherit-default' },
			simOracle: {
				mode: 'implemented',
				via: 'github-alert-ops simulation under the loaded-ops corruption oracles (formation, contained merge, marker-dropping unwrap)'
			}
		})
	});

	registerBlockComponent(kind, defineBlockComponent(AdmonitionBlock));
}
