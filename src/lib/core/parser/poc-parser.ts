/****
 * Narrow two-pass markdown parser used for the Phase 0 proof of concept.
 ****/
import type { SourceRange } from "../types.js";
import type {
    ProofOfConceptBlock,
    ProofOfConceptBlockKind,
    ProofOfConceptDocument,
    ProofOfConceptInlineToken,
    ProofOfConceptInlineTokenKind,
} from "./poc-types.js";

interface ParsedLine {
    raw: string;
    text: string;
    lineEnding: string;
    start: number;
    end: number;
}

export function parseMarkdownProofOfConcept(source: string): ProofOfConceptDocument {
    const blockDocument = parseBlocksProofOfConcept(source);

    // The PoC keeps block recognition and inline token spotting separate to mirror the target architecture.
    return annotateInlineProofOfConcept(blockDocument);
}

export function parseBlocksProofOfConcept(source: string): ProofOfConceptDocument {
    const lines = splitLines(source);
    const blocks: ProofOfConceptBlock[] = [];
    let prefix = "";
    let pendingTrivia = "";
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];

        if (isBlankLine(line.text)) {
            if (blocks.length === 0) {
                prefix += line.raw;
            } else {
                pendingTrivia += line.raw;
            }

            index += 1;
            continue;
        }

        const { block, nextIndex } = parseNextBlock(lines, index, pendingTrivia);
        blocks.push(block);
        pendingTrivia = "";
        index = nextIndex;
    }

    return {
        source,
        prefix,
        blocks,
        suffix: pendingTrivia,
    };
}

export function annotateInlineProofOfConcept(document: ProofOfConceptDocument): ProofOfConceptDocument {
    return {
        ...document,
        blocks: document.blocks.map((block) => {
            if (!isInlineTextBlock(block.kind)) {
                return block;
            }

            return {
                ...block,
                inlineTokens: collectInlineTokens(block.source, block.range.start),
            };
        }),
    };
}

function parseNextBlock(lines: ParsedLine[], startIndex: number, leadingTrivia: string): { block: ProofOfConceptBlock; nextIndex: number } {
    const line = lines[startIndex];
    const fencedCode = matchFenceOpen(line.text);

    if (fencedCode) {
        let endIndex = startIndex + 1;
        let closed = false;

        while (endIndex < lines.length) {
            if (matchFenceClose(lines[endIndex].text, fencedCode.marker, fencedCode.length)) {
                endIndex += 1;
                closed = true;
                break;
            }

            endIndex += 1;
        }

        const source = joinRaw(lines, startIndex, endIndex);
        const range = createRange(lines[startIndex].start, lines[Math.max(startIndex, endIndex - 1)].end);

        return {
            block: {
                kind: "fencedCode",
                leadingTrivia,
                range,
                source,
                text: source,
                inlineTokens: [],
                metadata: {
                    fenceMarker: fencedCode.marker,
                    fenceLength: fencedCode.length,
                    closed,
                },
            },
            nextIndex: endIndex,
        };
    }

    const heading = matchHeading(line.text);
    if (heading) {
        return {
            block: createSingleLineBlock("heading", line, leadingTrivia, stripTrailingLineEnding(line.raw), {
                headingLevel: heading.level,
            }),
            nextIndex: startIndex + 1,
        };
    }

    const thematicBreak = matchThematicBreak(line.text);
    if (thematicBreak) {
        return {
            block: createSingleLineBlock("thematicBreak", line, leadingTrivia, stripTrailingLineEnding(line.raw), {
                thematicMarker: thematicBreak,
            }),
            nextIndex: startIndex + 1,
        };
    }

    const blockquote = matchBlockquote(line.text);
    if (blockquote) {
        let endIndex = startIndex + 1;

        while (endIndex < lines.length && !isBlankLine(lines[endIndex].text) && matchBlockquote(lines[endIndex].text)) {
            endIndex += 1;
        }

        const source = joinRaw(lines, startIndex, endIndex);
        const range = createRange(lines[startIndex].start, lines[endIndex - 1].end);
        const text = lines
            .slice(startIndex, endIndex)
            .map((entry) => stripBlockquotePrefix(entry.text))
            .join("\n");

        return {
            block: {
                kind: "blockquote",
                leadingTrivia,
                range,
                source,
                text,
                inlineTokens: [],
                metadata: {
                    quoteDepth: blockquote.depth,
                },
            },
            nextIndex: endIndex,
        };
    }

    const listItem = matchListItem(line.text);
    if (listItem) {
        const listItemText = stripListMarker(line.text);
        const taskCheckbox = matchTaskCheckbox(listItemText);

        return {
            block: createSingleLineBlock("listItem", line, leadingTrivia, listItemText, {
                listMarker: listItem.marker,
                ordered: listItem.ordered,
                taskItem: taskCheckbox !== null,
                taskChecked: taskCheckbox?.checked,
            }),
            nextIndex: startIndex + 1,
        };
    }

    // Everything the PoC cannot classify as a supported block shape stays paragraph-like and round-trippable.
    let endIndex = startIndex + 1;
    while (endIndex < lines.length && !isBlankLine(lines[endIndex].text) && !startsRecognizedBlock(lines[endIndex].text)) {
        endIndex += 1;
    }

    const source = joinRaw(lines, startIndex, endIndex);
    const range = createRange(lines[startIndex].start, lines[endIndex - 1].end);
    const text = lines
        .slice(startIndex, endIndex)
        .map((entry) => entry.text)
        .join("\n");

    return {
        block: {
            kind: "paragraph",
            leadingTrivia,
            range,
            source,
            text,
            inlineTokens: [],
            metadata: {},
        },
        nextIndex: endIndex,
    };
}

function createSingleLineBlock(
    kind: ProofOfConceptBlockKind,
    line: ParsedLine,
    leadingTrivia: string,
    text: string,
    metadata: ProofOfConceptBlock["metadata"]
): ProofOfConceptBlock {
    return {
        kind,
        leadingTrivia,
        range: createRange(line.start, line.end),
        source: line.raw,
        text,
        inlineTokens: [],
        metadata,
    };
}

function collectInlineTokens(source: string, baseOffset: number): ProofOfConceptInlineToken[] {
    const tokens: ProofOfConceptInlineToken[] = [];

    addTokens(tokens, source, /!\[[^\]]*\]\([^\)]+\)/g, "image", baseOffset);
    // The link pattern intentionally skips image syntax because images are tracked as their own atomic inline shape.
    addTokens(tokens, source, /\[[^\]]+\]\([^\)]+\)/g, "link", baseOffset, (_, index, fullSource) => index === 0 || fullSource[index - 1] !== "!");
    addTokens(tokens, source, /`[^`\n]+`/g, "inlineCode", baseOffset);
    addTokens(tokens, source, /~~[^~\n]+~~/g, "strikethrough", baseOffset);
    addTokens(tokens, source, /\*\*[^*\n]+\*\*|__[^_\n]+__/g, "strong", baseOffset);
    addTokens(tokens, source, /\*[^*\n]+\*|_[^_\n]+_/g, "emphasis", baseOffset);
    addTokens(tokens, source, /\bhttps?:\/\/[^\s<]+|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "autolink", baseOffset);

    return tokens.sort((left, right) => left.range.start - right.range.start || left.range.end - right.range.end);
}

function addTokens(
    tokens: ProofOfConceptInlineToken[],
    source: string,
    pattern: RegExp,
    kind: ProofOfConceptInlineTokenKind,
    baseOffset: number,
    predicate?: (match: string, index: number, source: string) => boolean
): void {
    for (const match of source.matchAll(pattern)) {
        const value = match[0];
        const index = match.index ?? 0;

        if (predicate && !predicate(value, index, source)) {
            continue;
        }

        const rangeStart = baseOffset + index;
        const rangeEnd = rangeStart + value.length;

        if (tokens.some((token) => rangeStart < token.range.end && rangeEnd > token.range.start)) {
            continue;
        }

        tokens.push({
            kind,
            range: createRange(rangeStart, rangeEnd),
            source: value,
        });
    }
}

function isInlineTextBlock(kind: ProofOfConceptBlockKind): boolean {
    return kind === "heading" || kind === "paragraph" || kind === "blockquote" || kind === "listItem";
}

function startsRecognizedBlock(text: string): boolean {
    return Boolean(matchFenceOpen(text) || matchHeading(text) || matchThematicBreak(text) || matchBlockquote(text) || matchListItem(text));
}

function splitLines(source: string): ParsedLine[] {
    const lines: ParsedLine[] = [];
    let start = 0;

    for (let index = 0; index < source.length; index += 1) {
        if (source[index] === "\n") {
            const raw = source.slice(start, index + 1);
            lines.push(createParsedLine(raw, start));
            start = index + 1;
        }
    }

    if (start < source.length || source.length === 0) {
        const raw = source.slice(start);
        if (raw.length > 0 || source.length === 0) {
            lines.push(createParsedLine(raw, start));
        }
    }

    return lines;
}

function createParsedLine(raw: string, start: number): ParsedLine {
    const lineEnding = raw.endsWith("\r\n") ? "\r\n" : raw.endsWith("\n") ? "\n" : "";
    const text = lineEnding.length > 0 ? raw.slice(0, -lineEnding.length) : raw;

    return {
        raw,
        text,
        lineEnding,
        start,
        end: start + raw.length,
    };
}

function joinRaw(lines: ParsedLine[], startIndex: number, endIndex: number): string {
    return lines.slice(startIndex, endIndex).map((line) => line.raw).join("");
}

function createRange(start: number, end: number): SourceRange {
    return { start, end };
}

function stripTrailingLineEnding(raw: string): string {
    return raw.endsWith("\r\n") ? raw.slice(0, -2) : raw.endsWith("\n") ? raw.slice(0, -1) : raw;
}

function isBlankLine(text: string): boolean {
    return text.trim().length === 0;
}

function matchHeading(text: string): { level: number } | null {
    const match = text.match(/^ {0,3}(#{1,6})(?:\s+|$)/);

    if (!match) {
        return null;
    }

    return { level: match[1].length };
}

function matchFenceOpen(text: string): { marker: "`" | "~"; length: number } | null {
    const match = text.match(/^ {0,3}([`~]{3,})([^`]*)?$/);

    if (!match) {
        return null;
    }

    const marker = match[1][0] as "`" | "~";

    return {
        marker,
        length: match[1].length,
    };
}

function matchFenceClose(text: string, marker: "`" | "~", minimumLength: number): boolean {
    const match = text.match(/^ {0,3}([`~]{3,})\s*$/);

    return Boolean(match && match[1][0] === marker && match[1].length >= minimumLength);
}

function matchBlockquote(text: string): { depth: number } | null {
    const match = text.match(/^( {0,3}> ?)+/);

    if (!match) {
        return null;
    }

    const depth = (match[0].match(/>/g) ?? []).length;

    return { depth };
}

function stripBlockquotePrefix(text: string): string {
    return text.replace(/^( {0,3}> ?)+/, "");
}

function matchListItem(text: string): { marker: string; ordered: boolean } | null {
    const match = text.match(/^ {0,3}((?:[*+-])|(?:\d+[.)]))\s+/);

    if (!match) {
        return null;
    }

    return {
        marker: match[1],
        ordered: /^\d/.test(match[1]),
    };
}

function stripListMarker(text: string): string {
    return text.replace(/^ {0,3}(?:(?:[*+-])|(?:\d+[.)]))\s+/, "");
}

function matchTaskCheckbox(text: string): { checked: boolean } | null {
    const match = text.match(/^\[( |x|X)\]\s+/);

    if (!match) {
        return null;
    }

    return {
        checked: match[1].toLowerCase() === "x",
    };
}

function matchThematicBreak(text: string): string | null {
    const normalized = text.trim();

    if (/^(?:\*\s*){3,}$/.test(normalized)) {
        return "*";
    }

    if (/^(?:-\s*){3,}$/.test(normalized)) {
        return "-";
    }

    if (/^(?:_\s*){3,}$/.test(normalized)) {
        return "_";
    }

    return null;
}
