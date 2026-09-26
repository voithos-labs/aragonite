/**
 * Native GitHub alerts as a strip container shaped like a blockquote: the source bytes are
 * kept, never rewritten to `:::note`. The marker lives only in the container's raw and
 * metadata, so `strip(raw)` equals the serialized children. Its own kind rather than a
 * variant of the directive admonition, so kind stability and rebuildRaw stay unambiguous.
 */

import {
	OPENER_PRIORITIES,
	blockquoteExtent,
	containerClosure,
	declarePluginKind,
	declaredPluginKind,
	defineBlockComponent,
	displayLines,
	firstLineEnding,
	getPluginMetadata,
	joinDisplayLines,
	ownTrailingLineEnding,
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

/** The `> [!TYPE]` line is the alert's own marker, so a blank line against it separates
 *  rather than becoming a block of its own; nothing closes the alert below. */
const BODY_WRAP: ContainerBodyWrap = { afterOpenerLine: true };

function tryOpen(ctx: OpenContext): BlockOpenerResult | null {
	const alertType = matchAlertMarker(ctx.line.text);
	if (!alertType) return null;

	// The built-in extent scan, not the marker regex, decides whether this line opens a
	// blockquote: backing out when it covers no lines keeps a marker-rule change from
	// reaching the parse loop as a return that consumes nothing.
	const { raw, nextIndex } = blockquoteExtent(ctx.lines, ctx.index, ctx.end, ctx.grammar);
	const consumed = nextIndex - ctx.index;
	if (consumed <= 0) return null;

	// A fresh parse entry, so the body's own line 0 must not read as the document top.
	const body = parseContainerBody(stripBody(ctx.lines, ctx.index + 1, nextIndex), BODY_WRAP, {
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

function stripBody(lines: ParsedLine[], start: number, end: number): string {
	let out = '';
	for (let i = start; i < end; i++) out += stripQuoteMarker(lines[i].text) + lines[i].lineEnding;
	return out;
}

/** Every body line keeps its own ending; the marker line keeps the one the current raw gives it. */
export function rebuildGithubAlertRaw(node: CstNode): void {
	const alertType = getPluginMetadata<GithubAlertMetadata>(node)?.alertType ?? 'NOTE';
	const marker = `> [!${alertType}]`;
	const body =
		(node.innerPrefix ?? '') + serializeChildren(node.children ?? []) + (node.innerSuffix ?? '');

	if (body === '') {
		node.raw = marker + ownTrailingLineEnding(node.raw);
		return;
	}
	const markerEnding = firstLineEnding(node.raw) ?? firstLineEnding(body) ?? '\n';
	node.raw = marker + markerEnding + prefixQuoteLines(body);
}

function prefixQuoteLines(body: string): string {
	const lines = displayLines(body);
	return joinDisplayLines(
		lines.map((line, i) => {
			// The empty line after a final break is no line of its own.
			if (i === lines.length - 1 && line.text === '') return line;
			return { ...line, text: line.text === '' ? '>' : `> ${line.text}` };
		})
	);
}

export function registerGithubAlert(): void {
	const kind = declarePluginKind(GITHUB_ALERT);

	registerBlockOpener(kind, {
		// Below blockquote so the alert form matches first, at a priority no other opener
		// uses, so a bundle installing them all keeps every priority unique (G1.10).
		priority: OPENER_PRIORITIES.blockquote - 5,
		tryOpen,
		interruptsParagraph: (t) => matchAlertMarker(t) !== null
	});

	registerBlockKind(kind, {
		label: 'Alert',
		// A note reads as part of the text around it, so it shows no drag handle.
		pageRole: 'prose',
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
