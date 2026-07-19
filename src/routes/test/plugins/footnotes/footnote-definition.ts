/**
 * The `[^label]: content` definition block: a real kind registered through the
 * opener registry, priced below the built-in `linkReferenceDefinition` so it
 * claims the footnote form first and declines everything else back to it.
 *
 * Modelled as an opaque, childless container (the render-primary pattern): the
 * source bytes are authoritative and live in metadata, `rebuildRaw` re-emits
 * them, and the component renders read-only. Continuation lines indented four
 * spaces (or a tab) belong to the definition; the full byte run is captured
 * verbatim from `ctx.lines`, so the round-trip is byte-exact and CRLF-safe.
 */

import {
	OPENER_PRIORITIES,
	declarePluginKind,
	declaredPluginKind,
	defineBlockComponent,
	getPluginMetadata,
	registerBlockComponent,
	registerBlockKind,
	registerBlockOpener,
	setPluginMetadata,
	type CstNode,
	type OpenContext
} from '$lib/plugin';
import FootnoteDefinition from './FootnoteDefinition.svelte';
import { FOOTNOTE_DEF_KIND } from './constants';

export interface FootnoteDefMetadata {
	label: string;
	/** The definition's full source bytes — the rebuild's only input. */
	raw: string;
}

const OPENER = /^ {0,3}\[\^([^\]\s]+)\]:/;

function isIndentedContinuation(text: string): boolean {
	return /^( {4,}|\t)/.test(text) && text.trim().length > 0;
}

function tryOpen(ctx: OpenContext): { node: CstNode; nextIndex: number } | null {
	const match = OPENER.exec(ctx.line.text);
	if (!match) return null;

	let next = ctx.index + 1;
	while (next < ctx.end && isIndentedContinuation(ctx.lines[next].text)) next++;

	const raw = ctx.lines
		.slice(ctx.index, next)
		.map((line) => line.raw)
		.join('');

	const node: CstNode = {
		kind: declaredPluginKind(FOOTNOTE_DEF_KIND),
		leadingTrivia: ctx.leadingTrivia,
		raw,
		children: []
	};
	setPluginMetadata<FootnoteDefMetadata>(node, { label: match[1], raw });
	return { node, nextIndex: next };
}

function rebuildRaw(node: CstNode): void {
	const meta = getPluginMetadata<FootnoteDefMetadata>(node);
	if (meta) node.raw = meta.raw;
}

export function registerFootnoteDefinition(): void {
	const kind = declarePluginKind(FOOTNOTE_DEF_KIND);

	registerBlockOpener(kind, {
		priority: OPENER_PRIORITIES.linkReferenceDefinition - 5,
		tryOpen,
		interruptsParagraph: false
	});

	registerBlockKind(kind, {
		mergeRole: 'not-mergeable',
		editable: false,
		supportsInline: false,
		conformanceFixture: '[^1]: A footnote definition.\n',
		container: { contract: 'opaque', rebuildRaw },
		closure: {
			roundTrip: {
				mode: 'implemented',
				via: 'opaque container contract — rebuildRaw re-emits the stored source bytes'
			},
			focus: {
				mode: 'not-supported',
				reason:
					'read-only opaque render, no caret target (whole-block focus deferred — needs e2e to verify)'
			},
			mergeBackspace: {
				mode: 'not-supported',
				reason: 'not-mergeable — a footnote definition does not merge with a neighbour'
			},
			selectionPaint: {
				mode: 'not-supported',
				reason:
					'custom read-only render exposes no measurable text range (unverified — no e2e in probe scope)'
			},
			searchPaint: { mode: 'inherit-default' },
			reorder: { mode: 'inherit-default' },
			undo: { mode: 'inherit-default' },
			clipboard: { mode: 'inherit-default' },
			simOracle: { mode: 'inherit-default' }
		}
	});

	registerBlockComponent(kind, defineBlockComponent(FootnoteDefinition));
}
