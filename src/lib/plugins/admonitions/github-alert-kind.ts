/**
 * Native GitHub alerts: a blockquote whose FIRST line is exactly `> [!TYPE]`
 * (`NOTE`/`TIP`/`IMPORTANT`/`WARNING`/`CAUTION`) parses as its own `githubAlert`
 * container kind, bytes untouched — never rewritten to `:::note`. A strip container
 * in the blockquote mold: the opener claims the whole blockquote (reusing the
 * built-in extent scan, so lazy continuation matches), stores its byte-exact raw,
 * and decomposes the `> `-stripped lines AFTER the marker into real child blocks.
 * The marker line lives only in the container's raw + metadata, so `strip(raw)`
 * equals the serialized children; `rebuildRaw` re-emits `> [!TYPE]` (source casing
 * preserved from metadata) + `> `-prefixed children, CRLF threaded.
 *
 * A separate kind, not a directive-admonition variant: kind stability and rebuildRaw
 * stay unambiguous per kind (the ATX/setext heading precedent). Editing inside
 * rebuilds through the marker and reparses to `githubAlert`; lifting the body out
 * (unwrap/merge) drops the marker and legitimately reparses as a plain blockquote.
 */

import {
	OPENER_PRIORITIES,
	blockquoteExtent,
	containerClosure,
	declarePluginKind,
	declaredPluginKind,
	defineBlockComponent,
	getPluginMetadata,
	parse,
	registerBlockComponent,
	registerBlockKind,
	registerBlockOpener,
	serializeChildren,
	setPluginMetadata,
	type BlockOpenerResult,
	type CstNode,
	type OpenContext,
	type ParsedLine
} from '$lib/plugin';
import { matchAlertMarker, stripQuoteMarker } from './gh-alert';
import { GITHUB_ALERT, type GithubAlertMetadata } from './kinds';
import AdmonitionBlock from './AdmonitionBlock.svelte';

function tryOpen(ctx: OpenContext): BlockOpenerResult | null {
	const alertType = matchAlertMarker(ctx.line.text);
	if (!alertType) return null;

	// Reuse the blockquote extent scan for the byte-exact raw + next index; the
	// children come from the body-only strip below (the marker line is not a child),
	// so the body is parsed exactly once.
	const { raw, nextIndex } = blockquoteExtent(ctx.lines, ctx.index, ctx.end);
	// The extent scan, not the marker regex, is the authority on whether this line
	// opens a blockquote at all. Declining when it claims nothing keeps a marker-rule
	// drift from ever reaching the parse loop as a non-advancing return.
	const consumed = nextIndex - ctx.index;
	if (consumed <= 0) return null;

	const body = parse(stripBody(ctx.lines, ctx.index + 1, nextIndex));

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

/** The `> `-stripped body: the lines after the marker with their quote prefix removed. */
function stripBody(lines: ParsedLine[], start: number, end: number): string {
	let out = '';
	for (let i = start; i < end; i++) out += stripQuoteMarker(lines[i].text) + lines[i].lineEnding;
	return out;
}

/**
 * Re-emit `raw` from metadata + children: the `> [!TYPE]` marker (casing verbatim
 * from metadata) then each body line quote-prefixed. Splitting the body on `\n`
 * keeps a `\r` at each segment's tail, so CRLF rides through; the marker's own
 * ending is detected off the current raw. A marker-only alert keeps just the marker.
 */
export function rebuildGithubAlertRaw(node: CstNode): void {
	const alertType = getPluginMetadata<GithubAlertMetadata>(node)?.alertType ?? 'NOTE';
	const marker = `> [!${alertType}]`;
	const body =
		(node.innerPrefix ?? '') + serializeChildren(node.children ?? []) + (node.innerSuffix ?? '');

	if (body === '') {
		node.raw = node.raw.endsWith('\n') ? marker + markerEnding(node.raw) : marker;
		return;
	}
	node.raw = marker + markerEnding(node.raw) + prefixQuoteLines(body);
}

/** The marker line's own ending — the first ending in `raw`, defaulting to LF. */
function markerEnding(raw: string): string {
	const nl = raw.indexOf('\n');
	if (nl < 0) return '\n';
	return raw[nl - 1] === '\r' ? '\r\n' : '\n';
}

/** `> ` on content lines, `>` on blank lines, threading each line's own ending. */
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
		// Below blockquote so the alert form is claimed first; a non-alert blockquote
		// falls through to the built-in. Its own slot, distinct from every other
		// opener, so the co-installed bundle declares unique priorities (G1.10).
		priority: OPENER_PRIORITIES.blockquote - 5,
		tryOpen,
		interruptsParagraph: (t) => matchAlertMarker(t) !== null
	});

	registerBlockKind(kind, {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		conformanceFixture: '> [!NOTE]\n> Heads up.\n',
		container: {
			contract: 'strip',
			rebuildRaw: rebuildGithubAlertRaw,
			// The alert IS a blockquote with a marker, so it unwraps exactly as one:
			// lifting the first child out drops the marker and reparses plain.
			unwrapRole: {
				firstChildBackspace: 'lift-first-child',
				middleChildBackspace: 'default-merge',
				quoteShaped: true
			},
			// A blockquote-shaped strip container: body children reorder within, exactly
			// as a blockquote's do. The `> [!TYPE]` marker is position-independent, so the
			// descriptor's rebuildRaw re-emits it after the move.
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
				via: 'mergeRole=container + unwrapRole (lift-first-child; default-merge) — Backspace at the body start lifts the first child out and drops the marker, leaving a plain blockquote'
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
