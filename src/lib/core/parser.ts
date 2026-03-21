/**
 * Single-pass, line-oriented GFM block parser.
 * Produces a recursive CST where serialize(parse(source)) === source.
 */

import {
    Document,
    Heading,
    Paragraph,
    FencedCode,
    ThematicBreak,
    SetextHeading,
    IndentedCode,
    HtmlBlock,
    LinkReferenceDefinition,
    Table,
    Blockquote,
    List,
    ListItem,
    type CstNode
} from './nodes';
import { splitLines, type ParsedLine } from './lines';

/** Parse a markdown source string into a Document CST. */
export function parse(source: string): Document {
    const lines = splitLines(source);
    const result = parseBlocks(lines, 0, lines.length);
    return new Document(result.prefix, result.children, result.suffix);
}

interface ParseBlocksResult {
    prefix: string;
    children: CstNode[];
    suffix: string;
}

export function parseBlocks(lines: ParsedLine[], start: number, end: number): ParseBlocksResult {
    const children: CstNode[] = [];
    let prefix = '';
    let pendingTrivia = '';
    let index = start;

    // Consume leading blank lines into prefix
    while (index < end && isBlankLine(lines[index].text)) {
        prefix += lines[index].raw;
        index++;
    }

    while (index < end) {
        const line = lines[index];

        if (isBlankLine(line.text)) {
            pendingTrivia += line.raw;
            index++;
            continue;
        }

        const { node, nextIndex } = parseNextBlock(
            lines,
            index,
            end,
            pendingTrivia,
            children.length === 0
        );
        children.push(node);
        pendingTrivia = '';
        index = nextIndex;
    }

    return { prefix, children, suffix: pendingTrivia };
}

function parseNextBlock(
    lines: ParsedLine[],
    startIndex: number,
    endIndex: number,
    leadingTrivia: string,
    isFirstBlock: boolean = false
): { node: CstNode; nextIndex: number } {
    const line = lines[startIndex];

    // Fenced code block
    const fence = matchFenceOpen(line.text);
    if (fence) {
        return parseFencedCode(lines, startIndex, endIndex, leadingTrivia, fence);
    }

    // ATX heading
    const heading = matchHeading(line.text);
    if (heading) {
        return {
            node: new Heading(leadingTrivia, line.raw, { level: heading.level }),
            nextIndex: startIndex + 1
        };
    }

    // Thematic break — setext detection in parseParagraph handles the ---/=== ambiguity
    const thematic = matchThematicBreak(line.text);
    if (thematic) {
        return {
            node: new ThematicBreak(leadingTrivia, line.raw, {
                marker: thematic
            }),
            nextIndex: startIndex + 1
        };
    }

    // Blockquote
    if (matchBlockquote(line.text)) {
        return parseBlockquote(lines, startIndex, endIndex, leadingTrivia);
    }

    // List item
    const listItem = matchListItem(line.text);
    if (listItem) {
        return parseList(lines, startIndex, endIndex, leadingTrivia);
    }

    // Indented code block — cannot interrupt a paragraph (GFM spec 4.4)
    if (matchIndentedCode(line.text) && (leadingTrivia.length > 0 || isFirstBlock)) {
        return parseIndentedCode(lines, startIndex, endIndex, leadingTrivia);
    }

    // HTML block
    if (matchHtmlBlock(line.text)) {
        return parseHtmlBlock(lines, startIndex, endIndex, leadingTrivia);
    }

    // Link reference definition (exclude footnote labels starting with ^)
    const linkRef = matchLinkReferenceDefinition(line.text);
    if (linkRef) {
        return {
            node: new LinkReferenceDefinition(leadingTrivia, line.raw, { label: linkRef.label }),
            nextIndex: startIndex + 1
        };
    }

    // Fallback: paragraph — consume continuation lines (also detects setext headings and tables)
    return parseParagraph(lines, startIndex, endIndex, leadingTrivia);
}

function parseFencedCode(
    lines: ParsedLine[],
    startIndex: number,
    endIndex: number,
    leadingTrivia: string,
    fence: { marker: '`' | '~'; length: number; info: string }
): { node: FencedCode; nextIndex: number } {
    let i = startIndex + 1;
    let closed = false;

    while (i < endIndex) {
        if (matchFenceClose(lines[i].text, fence.marker, fence.length)) {
            i++;
            closed = true;
            break;
        }
        i++;
    }

    const raw = joinRaw(lines, startIndex, i);
    return {
        node: new FencedCode(leadingTrivia, raw, {
            fenceMarker: fence.marker,
            fenceLength: fence.length,
            info: fence.info,
            closed
        }),
        nextIndex: i
    };
}

function parseParagraph(
    lines: ParsedLine[],
    startIndex: number,
    endIndex: number,
    leadingTrivia: string
): { node: Paragraph | SetextHeading | Table; nextIndex: number } {
    // Check for table: first line has a pipe and second line is a delimiter row
    if (startIndex + 1 < endIndex) {
        const delimiter = matchTableDelimiterRow(lines[startIndex + 1].text);
        if (delimiter && lines[startIndex].text.includes('|')) {
            return parseTable(lines, startIndex, endIndex, leadingTrivia, delimiter.columnCount);
        }
    }

    let i = startIndex + 1;

    while (i < endIndex && !isBlankLine(lines[i].text) && !startsNewBlock(lines[i].text)) {
        // Check if this line is a setext underline for the paragraph above
        const setext = matchSetextUnderline(lines[i].text);
        if (setext) {
            const raw = joinRaw(lines, startIndex, i + 1);
            return {
                node: new SetextHeading(leadingTrivia, raw, { level: setext.level }),
                nextIndex: i + 1
            };
        }
        i++;
    }

    const raw = joinRaw(lines, startIndex, i);
    return {
        node: new Paragraph(leadingTrivia, raw),
        nextIndex: i
    };
}

function parseIndentedCode(
    lines: ParsedLine[],
    startIndex: number,
    endIndex: number,
    leadingTrivia: string
): { node: IndentedCode; nextIndex: number } {
    let i = startIndex;

    while (i < endIndex) {
        if (matchIndentedCode(lines[i].text)) {
            i++;
        } else if (isBlankLine(lines[i].text)) {
            // Blank lines inside indented code are kept if followed by more indented lines
            let j = i + 1;
            while (j < endIndex && isBlankLine(lines[j].text)) j++;
            if (j < endIndex && matchIndentedCode(lines[j].text)) {
                i = j;
            } else {
                break;
            }
        } else {
            break;
        }
    }

    const raw = joinRaw(lines, startIndex, i);
    return {
        node: new IndentedCode(leadingTrivia, raw),
        nextIndex: i
    };
}

function parseHtmlBlock(
    lines: ParsedLine[],
    startIndex: number,
    endIndex: number,
    leadingTrivia: string
): { node: HtmlBlock; nextIndex: number } {
    let i = startIndex + 1;

    // Simplified: HTML blocks continue until a blank line
    while (i < endIndex && !isBlankLine(lines[i].text)) {
        i++;
    }

    const raw = joinRaw(lines, startIndex, i);
    return {
        node: new HtmlBlock(leadingTrivia, raw),
        nextIndex: i
    };
}

function parseTable(
    lines: ParsedLine[],
    startIndex: number,
    endIndex: number,
    leadingTrivia: string,
    columnCount: number
): { node: Table; nextIndex: number } {
    // Header row + delimiter row already confirmed, consume data rows
    let i = startIndex + 2;

    while (i < endIndex && !isBlankLine(lines[i].text) && lines[i].text.includes('|')) {
        i++;
    }

    const raw = joinRaw(lines, startIndex, i);
    return {
        node: new Table(leadingTrivia, raw, { columnCount }),
        nextIndex: i
    };
}

function parseBlockquote(
    lines: ParsedLine[],
    startIndex: number,
    endIndex: number,
    leadingTrivia: string
): { node: Blockquote; nextIndex: number } {
    // Collect continuation lines
    let i = startIndex;
    while (i < endIndex && matchBlockquote(lines[i].text)) {
        i++;
    }

    const raw = joinRaw(lines, startIndex, i);

    // Strip `> ` prefix from each line for recursive parse
    const strippedLines = lines.slice(startIndex, i).map((line) => {
        const stripped = line.text.replace(/^ {0,3}>[ \t]?/, '');
        const lineEnding = line.lineEnding;
        return {
            raw: stripped + lineEnding,
            text: stripped,
            lineEnding,
            start: 0,
            end: stripped.length + lineEnding.length
        } as ParsedLine;
    });

    // Recompute start offsets for stripped lines
    let offset = 0;
    for (const sl of strippedLines) {
        sl.start = offset;
        sl.end = offset + sl.raw.length;
        offset = sl.end;
    }

    const inner = parseBlocks(strippedLines, 0, strippedLines.length);

    // Count max quote depth
    const quoteDepth =
        lines[startIndex].text
            .match(/^ {0,3}(>[ \t]?)+/)?.[0]
            .split('')
            .filter((c) => c === '>').length ?? 1;

    return {
        node: new Blockquote(leadingTrivia, raw, inner.prefix, inner.children, inner.suffix, {
            quoteDepth
        }),
        nextIndex: i
    };
}

function parseList(
    lines: ParsedLine[],
    startIndex: number,
    endIndex: number,
    leadingTrivia: string
): { node: List; nextIndex: number } {
    const firstMatch = matchListItem(lines[startIndex].text)!;
    const ordered = firstMatch.ordered;
    const items: ListItem[] = [];
    let i = startIndex;

    while (i < endIndex) {
        const itemMatch = matchListItem(lines[i].text);
        if (!itemMatch || itemMatch.ordered !== ordered) break;

        const itemLine = lines[i];
        const contentText = itemLine.text.slice(itemMatch.indent);
        const task = matchTaskCheckbox(contentText);

        const innerText = task
            ? contentText.slice(contentText.match(/^\[.\]\s+/)![0].length)
            : contentText;

        const innerParagraph =
            innerText.length > 0 ? [new Paragraph('', innerText + itemLine.lineEnding)] : [];

        items.push(
            new ListItem('', itemLine.raw, '', innerParagraph, '', {
                marker: itemMatch.marker,
                taskItem: task !== null,
                taskChecked: task?.checked ?? false
            })
        );
        i++;
    }

    const raw = joinRaw(lines, startIndex, i);

    return {
        node: new List(leadingTrivia, raw, '', items, '', { ordered }),
        nextIndex: i
    };
}

// ── Matchers ────────────────────────────────────────────────────────────────

function matchHeading(text: string): { level: number } | null {
    const m = text.match(/^ {0,3}(#{1,6})(?:\s|$)/);
    return m ? { level: m[1].length } : null;
}

function matchFenceOpen(text: string): { marker: '`' | '~'; length: number; info: string } | null {
    const m = text.match(/^ {0,3}(`{3,})([^`]*)$|^ {0,3}(~{3,})(.*)$/);
    if (!m) return null;

    if (m[1]) {
        return { marker: '`', length: m[1].length, info: m[2].trim() };
    }
    return { marker: '~', length: m[3].length, info: m[4].trim() };
}

function matchFenceClose(text: string, marker: '`' | '~', minLength: number): boolean {
    const pattern = marker === '`' ? /^ {0,3}(`{3,})\s*$/ : /^ {0,3}(~{3,})\s*$/;
    const m = text.match(pattern);
    return Boolean(m && m[1].length >= minLength);
}

function matchSetextUnderline(text: string): { level: 1 | 2 } | null {
    if (/^ {0,3}=+\s*$/.test(text)) return { level: 1 };
    if (/^ {0,3}-+\s*$/.test(text)) return { level: 2 };
    return null;
}

export function matchThematicBreak(text: string): string | null {
    const trimmed = text.trim();
    if (/^(\*[ \t]*){3,}$/.test(trimmed)) return '*';
    if (/^(-[ \t]*){3,}$/.test(trimmed)) return '-';
    if (/^(_[ \t]*){3,}$/.test(trimmed)) return '_';
    return null;
}

const HTML_BLOCK_OPEN =
    /^ {0,3}(?:<(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|pre|script|section|source|style|summary|table|tbody|td|template|tfoot|th|thead|title|tr|track|ul)[\s/>]|<!--|<\?|<![A-Z]|<!\[CDATA\[)/i;

function matchHtmlBlock(text: string): boolean {
    return HTML_BLOCK_OPEN.test(text);
}

function matchLinkReferenceDefinition(text: string): { label: string } | null {
    const m = text.match(/^ {0,3}\[([^\]]+)\]:\s+/);
    if (!m || m[1].startsWith('^')) return null;
    return { label: m[1] };
}

function matchTableDelimiterRow(text: string): { columnCount: number } | null {
    const trimmed = text.trim();
    if (!trimmed.includes('|')) return null;

    const inner = trimmed.replace(/^\||\|$/g, '');
    const cells = inner.split('|');

    for (const cell of cells) {
        if (!/^\s*:?-+:?\s*$/.test(cell)) return null;
    }

    return { columnCount: cells.length };
}

function matchIndentedCode(text: string): boolean {
    return /^(?: {4}|\t)/.test(text);
}

function matchBlockquote(text: string): boolean {
    return /^ {0,3}>/.test(text);
}

export function matchListItem(
    text: string
): { marker: string; ordered: boolean; indent: number } | null {
    const m = text.match(/^( {0,3})([-*+])\s+/);
    if (m) {
        return {
            marker: m[2],
            ordered: false,
            indent: m[0].length
        };
    }

    const om = text.match(/^( {0,3})(\d{1,9}[.)])\s+/);
    if (om) {
        return {
            marker: om[2],
            ordered: true,
            indent: om[0].length
        };
    }

    return null;
}

function matchTaskCheckbox(text: string): { checked: boolean } | null {
    const m = text.match(/^\[( |x|X)\]\s+/);
    return m ? { checked: m[1].toLowerCase() === 'x' } : null;
}

function startsNewBlock(text: string): boolean {
    // Thematic breaks are deliberately excluded here. A `---` line does NOT
    // interrupt a paragraph from inside the continuation scan — it only gets
    // recognized at the top level of parseNextBlock (with the blank-line guard).
    // This prevents setext heading underlines from being split off as thematic breaks.
    return Boolean(
        matchFenceOpen(text) || matchHeading(text) || matchBlockquote(text) || matchListItem(text)
    );
}

// ── Utilities ───────────────────────────────────────────────────────────────

function isBlankLine(text: string): boolean {
    return text.trim().length === 0;
}

function joinRaw(lines: ParsedLine[], startIndex: number, endIndex: number): string {
    let result = '';
    for (let i = startIndex; i < endIndex; i++) {
        result += lines[i].raw;
    }
    return result;
}
