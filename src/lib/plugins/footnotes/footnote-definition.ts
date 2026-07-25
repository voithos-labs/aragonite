/**
 * The `[^label]: content` definition block: a strip container in the listItem
 * mold. The opener claims the footnote form (priced below the built-in
 * `linkReferenceDefinition`, which already declines leading-caret labels, so the
 * ordering is belt-and-suspenders) and decomposes the body — line 1's post-marker
 * text plus its dedented four-space/tab continuation lines — into real child
 * blocks via `parse`. The `[^label]: ` marker is pure syntax living only in the
 * container's own raw, so `strip(raw) === serialize(children)`; `rebuildRaw`
 * re-emits the marker (from metadata) and four-space continuation indents. Load is
 * byte-exact off the stored raw (CRLF included); a post-edit rebuild canonicalizes
 * the marker spacing and indent, exactly as listItem does.
 */

import {
	OPENER_PRIORITIES,
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
	type OpenContext
} from '$lib/plugin';
import FootnoteDefinition from './FootnoteDefinition.svelte';
import { FOOTNOTE_DEF_KIND } from './constants';

export interface FootnoteDefMetadata {
	label: string;
}

const OPENER = /^ {0,3}\[\^([^\]\s]+)\]:/;
/** The marker (leading indent + `[^label]:` + one optional separator space) stripped off line 1. */
const MARKER_STRIP = /^ {0,3}\[\^[^\]\s]+\]: ?/;
/** A continuation line's four-space (or one-tab) indent, stripped to dedent the body. */
const CONTINUATION_INDENT = /^(\t| {4})/;
const CONTINUATION_MARKER = '    ';

function isBlankLine(text: string): boolean {
	return text.trim() === '';
}

/**
 * The definition spans line 1 plus every following indented line, with blank lines
 * absorbed only when a later indented line still follows (GFM allows blank-separated
 * blocks inside a definition). A trailing blank run belongs to the document, not the
 * definition, so the scan returns the index just past the last confirmed content line.
 */
function scanDefinitionEnd(ctx: OpenContext): number {
	let lastContent = ctx.index;
	let i = ctx.index + 1;
	while (i < ctx.end) {
		const text = ctx.lines[i].text;
		if (isBlankLine(text)) {
			i++;
			continue;
		}
		if (CONTINUATION_INDENT.test(text)) {
			lastContent = i;
			i++;
			continue;
		}
		break;
	}
	return lastContent + 1;
}

function tryOpen(ctx: OpenContext): BlockOpenerResult | null {
	const match = OPENER.exec(ctx.line.text);
	if (!match) return null;

	const next = scanDefinitionEnd(ctx);
	const defLines = ctx.lines.slice(ctx.index, next);

	const raw = defLines.map((line) => line.raw).join('');
	const stripped = defLines
		.map((line, i) => line.raw.replace(i === 0 ? MARKER_STRIP : CONTINUATION_INDENT, ''))
		.join('');
	const body = parse(stripped);

	const node: CstNode = {
		kind: declaredPluginKind(FOOTNOTE_DEF_KIND),
		leadingTrivia: ctx.leadingTrivia,
		raw,
		innerPrefix: body.prefix,
		children: body.children,
		innerSuffix: body.suffix
	};
	setPluginMetadata<FootnoteDefMetadata>(node, { label: match[1] });
	return { node, consumed: next - ctx.index };
}

/**
 * Re-emit `raw` from the label metadata + children: the marker on line 1, a
 * four-space indent on every non-blank continuation line. Splitting on `\n` keeps a
 * `\r` at each segment's tail, so CRLF rides through; a blank continuation (`''` or
 * `'\r'`) stays unindented.
 */
export function rebuildFootnoteDefRaw(node: CstNode): void {
	const meta = getPluginMetadata<FootnoteDefMetadata>(node);
	const marker = `[^${meta?.label ?? ''}]: `;
	const inner =
		(node.innerPrefix ?? '') + serializeChildren(node.children ?? []) + (node.innerSuffix ?? '');
	const lines = inner.split('\n');
	node.raw = lines
		.map((line, i) => {
			if (i === lines.length - 1 && line === '') return '';
			if (i === 0) return marker + line;
			if (line === '' || line === '\r') return line;
			return CONTINUATION_MARKER + line;
		})
		.join('\n');
}

export function registerFootnoteDefinition(): void {
	const kind = declarePluginKind(FOOTNOTE_DEF_KIND);

	registerBlockOpener(kind, {
		// Below linkReferenceDefinition so the footnote form is claimed first (the LRD
		// parser also declines `^`-labels, so the ordering is belt-and-suspenders). Its
		// own sub-LRD slot, distinct from toc's `- 5`, so the two first-party plugins
		// never share a priority when co-installed (G1.10).
		priority: OPENER_PRIORITIES.linkReferenceDefinition - 4,
		tryOpen,
		interruptsParagraph: false
	});

	registerBlockKind(kind, {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		conformanceFixture: '[^1]: A footnote definition.\n',
		// A strip container in the listItem mold, but its body blocks reorder within
		// (unlike a listItem, whose leaf resolves to the item under the list). The
		// `[^label]:` marker is position-independent, so rebuildRaw re-emits it.
		container: { contract: 'strip', rebuildRaw: rebuildFootnoteDefRaw, reorderChildren: {} },
		closure: containerClosure({
			roundTripVia:
				'container contract=strip — rebuildFootnoteDefRaw re-emits the [^label]: marker + four-space continuation indent',
			focus: {
				mode: 'implemented',
				via: 'focus walks into the first child block via createContainerBlock'
			},
			mergeBackspace: {
				mode: 'implemented',
				via: 'not-mergeable — the definition never concatenates with a neighbour; a first-child Backspace at offset 0 delegates upward'
			},
			undo: { mode: 'inherit-default' },
			simOracle: { mode: 'inherit-default' }
		})
	});

	registerBlockComponent(kind, defineBlockComponent(FootnoteDefinition));
}
