/**
 * The `[^label]: content` definition block, a strip container shaped like a list item. The
 * marker is syntax living only in the container's own raw, so
 * `strip(raw) === serialize(children)`. Loading is byte-exact off the stored raw; a rebuild
 * after an edit normalizes marker spacing and indent, exactly as a list item does.
 */

import {
	OPENER_PRIORITIES,
	containerClosure,
	declarePluginKind,
	declaredPluginKind,
	defineBlockComponent,
	getPluginMetadata,
	isBlankLine,
	isBlankText,
	isWhitespaceChar,
	lineStartsOuterBlock,
	parseContainerBody,
	registerBlockComponent,
	registerBlockKind,
	registerBlockOpener,
	setPluginMetadata,
	splitLines,
	type BlockOpenerResult,
	type CstNode,
	type OpenContext
} from '#lib/plugin.js';
import FootnoteDefinition from './FootnoteDefinition.svelte';
import { FOOTNOTE_DEF_KIND } from './constants';

export interface FootnoteDefMetadata {
	label: string;
}

const OPENER = /^ {0,3}\[\^([^\]]+)\]:/;
const MARKER_STRIP = /^ {0,3}\[\^[^\]]+\]: ?/;
// Four columns, a tab counting to the next multiple of four, so no tab reaches past the body.
const CONTINUATION_INDENT = /^(?: {0,3}\t| {4})/;
const CONTINUATION_MARKER = '    ';

/** The `[^label]:` a line opens with, where the label holds no Markdown whitespace. */
function matchOpener(text: string): RegExpExecArray | null {
	const match = OPENER.exec(text);
	if (!match) return null;
	for (const ch of match[1]) if (isWhitespaceChar(ch)) return null;
	return match;
}

/** Per-line approximation of the body's open-paragraph state, as in the core blockquote/list
 *  lazy models: laziness reaches only the body's own top-level paragraph. */
function keepsParagraphOpen(strippedText: string, grammar: OpenContext['grammar']): boolean {
	if (isBlankLine(strippedText)) return false;
	if (matchOpener(strippedText)) return false;
	for (const opener of grammar.orderedOpeners()) {
		const interrupts = opener.interruptsParagraph;
		if (interrupts !== false && interrupts(strippedText)) return false;
	}
	return true;
}

/** A line indented to the body continues the definition, bare blank lines only while such a line
 *  follows; an unindented line continues only lazily, into an open paragraph (CommonMark §5.1). */
function scanDefinitionEnd(ctx: OpenContext): number {
	let lastContent = ctx.index;
	let paragraphOpen = keepsParagraphOpen(ctx.line.text.replace(MARKER_STRIP, ''), ctx.grammar);
	let i = ctx.index + 1;
	while (i < ctx.end) {
		const text = ctx.lines[i].text;
		if (CONTINUATION_INDENT.test(text)) {
			paragraphOpen = keepsParagraphOpen(text.replace(CONTINUATION_INDENT, ''), ctx.grammar);
			lastContent = i;
			i++;
			continue;
		}
		if (isBlankLine(text)) {
			paragraphOpen = false;
			i++;
			continue;
		}
		if (
			paragraphOpen &&
			!lineStartsOuterBlock(ctx.lines[i], { paragraphOpen: true, grammar: ctx.grammar })
		) {
			lastContent = i;
			i++;
			continue;
		}
		break;
	}
	return lastContent + 1;
}

function tryOpen(ctx: OpenContext): BlockOpenerResult | null {
	const match = matchOpener(ctx.line.text);
	if (!match) return null;

	const next = scanDefinitionEnd(ctx);
	const defLines = ctx.lines.slice(ctx.index, next);

	const raw = defLines.map((line) => line.raw).join('');
	const stripped = defLines
		.map((line, i) => line.raw.replace(i === 0 ? MARKER_STRIP : CONTINUATION_INDENT, ''))
		.join('');
	// A fresh parse entry, so the body's own line 0 must not read as the document top. The body has
	// no fence lines of its own, so no blank line is set aside from it.
	const body = parseContainerBody(stripped, {}, { scope: 'fragment', grammar: ctx.grammar });

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
 * A separator line stays unindented, as the parser reads it. The blank lines that end the body,
 * a leaf's own or the body's trailing line, take the indent that keeps them in the definition.
 */
export function rebuildFootnoteDefRaw(node: CstNode): void {
	const meta = getPluginMetadata<FootnoteDefMetadata>(node);
	const marker = `[^${meta?.label ?? ''}]: `;
	const lines: { text: string; lineEnding: string; separator: boolean }[] = [];
	const add = (bytes: string, separator: boolean) => {
		for (const line of splitLines(bytes)) lines.push({ ...line, separator });
	};
	add(node.innerPrefix ?? '', true);
	for (const child of node.children ?? []) {
		add(child.leadingTrivia, true);
		// A nested container's rebuild already indented the blank lines it keeps.
		add(child.raw, child.children !== undefined);
	}
	add(node.innerSuffix ?? '', false);
	let lastContent = lines.length - 1;
	while (lastContent >= 0 && isBlankText(lines[lastContent].text)) lastContent--;

	let raw = '';
	lines.forEach(({ text, lineEnding, separator }, i) => {
		if (raw === '') raw += marker + text + lineEnding;
		else if (text === '' && (separator || i < lastContent)) raw += lineEnding;
		else raw += CONTINUATION_MARKER + text + lineEnding;
	});
	node.raw = raw;
}

export function registerFootnoteDefinition(): void {
	const kind = declarePluginKind(FOOTNOTE_DEF_KIND);

	registerBlockOpener(kind, {
		// Below linkReferenceDefinition so the footnote form matches first, at a priority of
		// its own so no two bundled plugins share one (G1.10).
		priority: OPENER_PRIORITIES.linkReferenceDefinition - 4,
		tryOpen,
		interruptsParagraph: false
	});

	registerBlockKind(kind, {
		label: 'Footnote',
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		// A conformance fixture has to survive rebuildRaw unchanged, so the continuation line
		// is indented: the lazy form would be rewritten.
		conformanceFixture: '[^1]: A footnote definition.\n    with an indented continuation.\n',
		// Body blocks reorder inside the definition, unlike a list item, which moves under its
		// list; the marker does not depend on position, so rebuildRaw re-emits it.
		container: {
			contract: 'strip',
			rebuildRaw: rebuildFootnoteDefRaw,
			reorderChildren: {},
			// The marker lives in metadata rather than the first line, so lifting the first child
			// out leaves a definition behind, not the plain blockquote a quote lift leaves.
			unwrapRole: {
				firstChildBackspace: 'lift-first-child-keep-container',
				middleChildBackspace: 'default-merge'
			}
		},
		closure: containerClosure({
			roundTripVia:
				'container contract=strip — rebuildFootnoteDefRaw re-emits the [^label]: marker + four-space continuation indent',
			focus: {
				mode: 'implemented',
				via: 'focus walks into the first child block via createContainerBlock'
			},
			mergeBackspace: {
				mode: 'implemented',
				via: 'not-mergeable outward, so nothing below concatenates into the note; within the body, unwrapRole lifts the first block out (lift-first-child-keep-container) and later blocks default-merge'
			},
			undo: { mode: 'inherit-default' },
			simOracle: { mode: 'inherit-default' }
		})
	});

	registerBlockComponent(kind, defineBlockComponent(FootnoteDefinition));
}
