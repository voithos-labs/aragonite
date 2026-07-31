/**
 * The `[^label]: content` definition block as a strip container in the listItem mold.
 * The marker is pure syntax living only in the container's own raw, so
 * `strip(raw) === serialize(children)`. Load is byte-exact off the stored raw; a
 * post-edit rebuild canonicalizes marker spacing and indent, exactly as listItem does.
 */

import {
	OPENER_PRIORITIES,
	containerClosure,
	declarePluginKind,
	declaredPluginKind,
	defineBlockComponent,
	getPluginMetadata,
	isBlankLine,
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
const MARKER_STRIP = /^ {0,3}\[\^[^\]\s]+\]: ?/;
const CONTINUATION_INDENT = /^(\t| {4})/;
const CONTINUATION_MARKER = '    ';

/**
 * Blank lines are absorbed only when a later indented line still follows, since GFM
 * allows blank-separated blocks inside a definition; a trailing blank run belongs to
 * the document, so the scan stops at the last confirmed content line.
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

/** Splitting on `\n` keeps a `\r` at each segment's tail, so CRLF rides through; a blank
 *  continuation stays unindented. */
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
		// Below linkReferenceDefinition so the footnote form is claimed first, in its own
		// sub-LRD slot so no two co-installed first-party plugins share it (G1.10).
		priority: OPENER_PRIORITIES.linkReferenceDefinition - 4,
		tryOpen,
		interruptsParagraph: false
	});

	registerBlockKind(kind, {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		conformanceFixture: '[^1]: A footnote definition.\n',
		// Unlike a listItem, whose leaf resolves to the item under the list, the body
		// blocks reorder within; the marker is position-independent, so rebuildRaw re-emits it.
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
