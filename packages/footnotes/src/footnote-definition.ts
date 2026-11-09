/**
 * The `[^label]: content` definition block, a strip container shaped like a list item. The
 * marker is syntax living only in the container's own raw, so `strip(raw) === serialize(children)`,
 * and the parser strips each line the way the rebuild reads it back, so an edit keeps the lines it
 * didn't touch.
 */

import {
	OPENER_PRIORITIES,
	declarePluginKind,
	declaredPluginKind,
	isBlankLine,
	isWhitespaceChar,
	lineStartsOuterBlock,
	parseContainerBody,
	registerBlockKind,
	setPluginMetadata,
	stripShapedLines,
	type BlockOpenerResult,
	type BlockView,
	type CstNode,
	type IndentedLines,
	type OpenContext
} from '@voithos-labs/aragonite/plugin';
import { FOOTNOTE_DEF_KIND } from './constants';

export interface FootnoteDefMetadata {
	label: string;
}

const OPENER = /^ {0,3}\[\^([^\]]+)\]:/;
const MARKER_STRIP = /^ {0,3}\[\^([^\]]+)\]: ?/;
// Four columns, a tab counting to the next multiple of four, so no tab reaches past the body.
const CONTINUATION_INDENT = /^(?: {0,3}\t| {4})/;

/** A definition's lines: the `[^label]:` marker on the first, the rest indented four columns. */
const DEFINITION_LINES: IndentedLines<FootnoteDefMetadata> = {
	shape: 'indented',
	open: MARKER_STRIP,
	data: (match) => ({ label: match[1] }),
	first: (data) => `[^${data.label}]: `,
	rest: () => '    ',
	lazy: true
};

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
	// Read through the lines the writer writes, so a write keeps every line it didn't change.
	const stripped = stripShapedLines(DEFINITION_LINES, { label: match[1] }, defLines);
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

export function registerFootnoteDefinition(view: BlockView): void {
	const kind = declarePluginKind(FOOTNOTE_DEF_KIND);

	registerBlockKind(kind, {
		view,
		opener: {
			// Below linkReferenceDefinition so the footnote form matches first, at a priority of
			// its own so no two bundled plugins share one (G1.10).
			priority: OPENER_PRIORITIES.linkReferenceDefinition - 4,
			tryOpen,
			interruptsParagraph: false
		},
		label: 'Footnote',
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		// A conformance fixture has to survive a write unchanged, so the continuation line is
		// indented: the lazy form would be rewritten.
		conformanceFixture: '[^1]: A footnote definition.\n    with an indented continuation.\n',
		// Body blocks reorder inside the definition, unlike a list item, which moves under its
		// list; the marker does not depend on position, so the writer puts it back.
		container: {
			lines: DEFINITION_LINES,
			merges: { key: 'label' },
			reorderChildren: {},
			// The marker lives in metadata rather than the first line, so lifting the first child
			// out leaves a definition behind, not the plain blockquote a quote lift leaves.
			unwrapRole: {
				firstChildBackspace: 'lift-first-child-keep-container',
				middleChildBackspace: 'default-merge'
			}
		}
	});
}
