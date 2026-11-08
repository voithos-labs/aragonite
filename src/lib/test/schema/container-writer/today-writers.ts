// Each container kind's own writer and line syntax as they stood before the container writer, which
// the differential compares it against. Delete it with the registration that takes a `rebuildRaw`.

import { getPluginMetadata, metadataOf, type CstNode } from '#lib/core/nodes.js';
import {
	firstDisplayLine,
	indentColumns,
	isBlankLine,
	ownTrailingLineEnding,
	stripIndentColumns,
	trimTrailingLineEnding
} from '#lib/core/lines.js';
import { concatChildren } from '#lib/core/serializer.js';
import type { LineCodec } from '#lib/core/strip-lines.js';
import { matchDirectiveOpener, serializeDirective } from '#lib/core/directive/grammar.js';
import { lineStartsOuterBlock } from '#lib/schema/block-openers.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { rebuildStripRaw } from '#lib/schema/strip-rebuild.js';
import type { ChildRawChange } from '#lib/schema/child-spans.js';
import type { Writer } from './differential';

const grammar = defaultGrammarView;

function opensOuterBlock(line: string): boolean {
	const parsed = { raw: line, text: line, lineEnding: '', start: 0, end: line.length };
	return lineStartsOuterBlock(parsed, { paragraphOpen: true, grammar });
}

// ── Quote ────────────────────────────────────────────────────────────────────

const QUOTE_PREFIX = /^ {0,3}>[ \t]?/;

const quoteKeepsParagraph = (text: string): boolean =>
	!isBlankLine(text) && !grammar.interruptsParagraph(text) && !/^ {0,3}>/.test(text);

const quoteLines: LineCodec = {
	read(line, place) {
		const prefix = QUOTE_PREFIX.exec(line)?.[0];
		if (prefix === undefined) {
			return place.first || isBlankLine(line) ? null : { text: line, prefix: '', lazy: true };
		}
		return { text: line.slice(prefix.length), prefix, lazy: false };
	},
	write: (text) => (text === '' ? '>' : '> ' + text),
	spells: (line, text) =>
		text === ''
			? line === '>'
			: line.length === text.length + 2 &&
				line[0] === '>' &&
				line[1] === ' ' &&
				line.slice(2) === text,
	continuesLazily: (above, line) =>
		quoteKeepsParagraph(above) && quoteKeepsParagraph(line) && !opensOuterBlock(line)
};

function rebuildBlockquoteRaw(node: CstNode, changed?: ChildRawChange) {
	if (!node.children) return;
	return rebuildStripRaw(node, quoteLines, { grammar, changed });
}

// ── Hanging indent: list item, footnote definition ───────────────────────────

interface HangingIndent {
	opener: string;
	column: number;
	readOpener: (line: string) => string | null;
	continuesLazily?: LineCodec['continuesLazily'];
}

const keepsParagraph = (text: string): boolean =>
	!isBlankLine(text) && !grammar.interruptsParagraph(text);

function leadingTab(text: string): boolean {
	for (let i = 0; text[i] === ' ' || text[i] === '\t'; i++) if (text[i] === '\t') return true;
	return false;
}

function hangingIndentLines(shape: HangingIndent): LineCodec {
	const { opener, column, readOpener } = shape;
	const pad = ' '.repeat(column);
	return {
		read(line, place) {
			if (place.first) {
				const prefix = readOpener(line);
				return prefix === null ? null : { text: line.slice(prefix.length), prefix, lazy: false };
			}
			const text = stripIndentColumns(line, column);
			if (indentColumns(line) >= column) {
				const cut = line.length - text.length;
				const prefix = cut >= 0 && line.slice(cut) === text ? line.slice(0, cut) : null;
				return { text, prefix, lazy: false };
			}
			if (isBlankLine(line))
				return place.trailingBlank ? null : { text, prefix: line, lazy: false };
			return { text, prefix: line.slice(0, line.length - text.length), lazy: true };
		},
		write(text, place) {
			if (place.first) return opener + text;
			return text === '' && !place.trailingBlank ? '' : pad + text;
		},
		spells(line, text, place) {
			if (place.first) return false;
			if (text === '' && !place.trailingBlank) return line === '';
			return (
				line.length === column + text.length &&
				line.startsWith(pad) &&
				line.slice(column) === text &&
				!(column % 4 !== 0 && leadingTab(text))
			);
		},
		continuesLazily:
			shape.continuesLazily ??
			((above, line) => keepsParagraph(above) && keepsParagraph(line) && !opensOuterBlock(line))
	};
}

interface ItemLineShape {
	indent: string;
	marker: string;
	taskMarker: string | null;
}

const ITEM_START = /^( {0,3})((?:[-*+]|\d{1,9}[.)])[ \t]+)/;

function readItemShape(line: string): ItemLineShape | null {
	const m = line.match(ITEM_START);
	if (!m) return null;
	const task = /^\[( |x|X)\][ \t]+/.exec(line.slice(m[0].length));
	return { indent: m[1], marker: m[2], taskMarker: task?.[0] ?? null };
}

const itemKeepsParagraph = (text: string): boolean =>
	!isBlankLine(text) && !ITEM_START.test(text) && !grammar.interruptsParagraph(text);

function listItemLines(shape: ItemLineShape): LineCodec {
	const opener = shape.indent + shape.marker + (shape.taskMarker ?? '');
	return hangingIndentLines({
		opener,
		column: shape.indent.length + shape.marker.length,
		readOpener(line) {
			const read = readItemShape(line);
			const same =
				read?.indent === shape.indent &&
				read.marker === shape.marker &&
				read.taskMarker === shape.taskMarker;
			return same ? opener : null;
		},
		continuesLazily: (above, line, aboveFirst) =>
			itemKeepsParagraph(aboveFirst ? (shape.taskMarker ?? '') + above : above) &&
			itemKeepsParagraph(line) &&
			!opensOuterBlock(line)
	});
}

function rebuildListItemRaw(node: CstNode, changed?: ChildRawChange) {
	if (!node.children || !node.metadata) return;
	const meta = metadataOf(node, 'listItem');
	const previous = readItemShape(firstDisplayLine(node.raw).text);
	const shape = {
		indent: previous?.indent ?? '',
		marker: meta.marker ?? '- ',
		taskMarker: meta.taskMarker ?? null
	};
	const lines = listItemLines(shape);
	const unchanged =
		!previous || (previous.marker === shape.marker && previous.taskMarker === shape.taskMarker);
	const was = unchanged ? lines : listItemLines(previous);
	return rebuildStripRaw(node, lines, { grammar, changed, previous: was });
}

function definitionLines(label: string): LineCodec {
	const mark = `[^${label}]:`;
	return hangingIndentLines({
		opener: mark + ' ',
		column: 4,
		readOpener(line) {
			const lead = /^ {0,3}/.exec(line)![0].length;
			if (!line.startsWith(mark, lead)) return null;
			const end = lead + mark.length;
			return line.slice(0, line[end] === ' ' ? end + 1 : end);
		}
	});
}

function rebuildFootnoteDefRaw(node: CstNode, changed?: ChildRawChange) {
	const label = getPluginMetadata<{ label: string }>(node)?.label ?? '';
	return rebuildStripRaw(node, definitionLines(label), { grammar, changed });
}

// ── Alert ────────────────────────────────────────────────────────────────────

const bodyIsEmpty = (node: CstNode): boolean =>
	!node.innerPrefix &&
	!node.innerSuffix &&
	(node.children ?? []).every((child) => child.leadingTrivia === '' && child.raw === '');

function rebuildGithubAlertRaw(node: CstNode, changed?: ChildRawChange) {
	const alertType = getPluginMetadata<{ alertType: string }>(node)?.alertType ?? 'NOTE';
	const marker = `> [!${alertType}]`;
	if (bodyIsEmpty(node)) {
		node.raw = marker + ownTrailingLineEnding(node.raw);
		return;
	}
	return rebuildStripRaw(node, quoteLines, { grammar, changed, opener: marker });
}

// ── `:::` containers and `<details>` ─────────────────────────────────────────

function rebuildDirectiveContainerRaw(node: CstNode): void {
	const [row, ...body] = node.children ?? [];
	const line = row ? trimTrailingLineEnding(row.raw) : '';
	const fence = matchDirectiveOpener(line);
	const innerPrefix = node.innerPrefix ?? '';
	const innerSuffix = node.innerSuffix ?? '';
	// The closing line as the parse once stored it, read off the bytes it replaces.
	const last = trimTrailingLineEnding(node.raw).split('\n').pop() ?? '';
	const closerColonCount = /^:+$/.test(last) ? last.length : (fence?.colonCount ?? 3);
	const closerNewline = ownTrailingLineEnding(node.raw) !== '';
	const closerLineEnding = ownTrailingLineEnding(node.raw) || undefined;
	const lineEnding = (row && ownTrailingLineEnding(row.raw)) || '\n';
	node.raw = fence
		? serializeDirective({
				colonCount: fence.colonCount,
				name: fence.name,
				info: fence.info,
				innerPrefix,
				body: concatChildren(body),
				innerSuffix,
				closerColonCount,
				closerNewline,
				lineEnding,
				closerLineEnding
			})
		: `${line}${lineEnding}${innerPrefix}${concatChildren(body)}${innerSuffix}` +
			':'.repeat(closerColonCount) +
			(closerNewline ? (closerLineEnding ?? lineEnding) : '');
}

function rebuildDetailsRaw(node: CstNode): void {
	const meta = getPluginMetadata<{ open: boolean; lineEnding: string; closerNewline: boolean }>(
		node
	);
	const open = meta?.open ?? false;
	const lineEnding = meta?.lineEnding ?? '\n';
	const closerEnd = (meta?.closerNewline ?? true) ? lineEnding : '';
	const children = node.children ?? [];
	const summaryText = children[0] ? trimTrailingLineEnding(children[0].raw) : '';
	const body = children.slice(1);
	const inner = (node.innerPrefix ?? '') + concatChildren(body) + (node.innerSuffix ?? '');
	const opener = `<details${open ? ' open' : ''}>${lineEnding}<summary>${summaryText}</summary>`;
	node.raw = `${opener}${lineEnding}${inner}</details>${closerEnd}`;
}

// ── By kind ──────────────────────────────────────────────────────────────────

const WRITERS: Record<string, Writer> = {
	blockquote: rebuildBlockquoteRaw,
	githubAlert: rebuildGithubAlertRaw,
	listItem: rebuildListItemRaw,
	'footnote-def': rebuildFootnoteDefRaw,
	directiveContainer: rebuildDirectiveContainerRaw,
	admonition: rebuildDirectiveContainerRaw,
	details: rebuildDetailsRaw
};

/** Today's writer for the container's kind. */
export const todayWriter: Writer = (node, changed) => WRITERS[node.kind](node, changed);

/** Today's writer for a GitHub alert, for a kind that writes like one. */
export const todayAlertWriter: Writer = rebuildGithubAlertRaw;
