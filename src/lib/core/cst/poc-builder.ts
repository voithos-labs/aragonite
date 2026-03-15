/**
 * Builders and invariant checks for the Phase 0 CST proof of concept.
 */
import type { SourceRange } from "../types.js";
import { parseBlocksProofOfConcept, parseMarkdownProofOfConcept } from "../parser/index.js";
import type { ProofOfConceptBlock } from "../parser/poc-types.js";
import type {
    CstOwnershipProof,
    CstOwnershipSegment,
    CstOwnershipValidationResult,
    CstProofNode,
    CstProofToken,
    DelimiterAccountingEntry,
    DelimiterAccountingProof,
    RecoveryRegionProof,
} from "./poc-types.js";

interface RawLine {
    raw: string;
    text: string;
    start: number;
    end: number;
}

const DELIMITER_CHARACTERS = new Set(["*", "_", "~"]);

export function buildCstOwnershipProofOfConcept(source: string): CstOwnershipProof {
    const document = parseBlocksProofOfConcept(source);
    const nodes: CstProofNode[] = [];
    const segments: CstOwnershipSegment[] = [];
    let cursor = 0;

    // Proof segments are built in strict source order so ownership gaps/overlaps can be detected mechanically.
    if (document.prefix.length > 0) {
        segments.push(createSegment("documentPrefix", "document", "prefix", cursor, cursor + document.prefix.length, source));
        cursor += document.prefix.length;
    }

    document.blocks.forEach((block, index) => {
        const nodeId = `block:${index}`;
        let leadingTriviaRange: SourceRange | undefined;

        if (block.leadingTrivia.length > 0) {
            leadingTriviaRange = createRange(cursor, cursor + block.leadingTrivia.length);
            segments.push(createSegment("leadingTrivia", nodeId, "leadingTrivia", leadingTriviaRange.start, leadingTriviaRange.end, source));
            cursor = leadingTriviaRange.end;
        }

        const blockResult = createBlockOwnership(nodeId, block, source);
        nodes.push({
            id: nodeId,
            kind: block.kind,
            range: block.range,
            leadingTriviaRange,
            tokens: blockResult.tokens,
            textRanges: blockResult.textRanges,
            flags: blockResult.flags,
        });
        segments.push(...blockResult.segments);
        cursor = block.range.end;
    });

    if (document.suffix.length > 0) {
        segments.push(createSegment("documentSuffix", "document", "suffix", cursor, cursor + document.suffix.length, source));
    }

    return {
        source,
        nodes,
        segments,
    };
}

export function validateCstOwnershipProof(proof: CstOwnershipProof): CstOwnershipValidationResult {
    const issues: string[] = [];
    const segments = [...proof.segments].sort((left, right) => left.range.start - right.range.start || left.range.end - right.range.end);
    let cursor = 0;

    for (const segment of segments) {
        if (segment.range.start !== cursor) {
            issues.push(`Ownership gap or overlap before ${segment.ownerId}:${segment.label} at ${cursor}-${segment.range.start}.`);
        }

        const expectedSource = proof.source.slice(segment.range.start, segment.range.end);
        if (expectedSource !== segment.source) {
            issues.push(`Segment source mismatch for ${segment.ownerId}:${segment.label}.`);
        }

        cursor = segment.range.end;
    }

    if (cursor !== proof.source.length) {
        issues.push(`Ownership does not cover the full source length. Covered ${cursor}, expected ${proof.source.length}.`);
    }

    for (const node of proof.nodes) {
        for (const token of node.tokens) {
            if (token.range.start < node.range.start || token.range.end > node.range.end) {
                issues.push(`Token ${token.kind} escapes node range for ${node.id}.`);
            }
        }

        for (const textRange of node.textRanges) {
            if (textRange.start < node.range.start || textRange.end > node.range.end) {
                issues.push(`Text range escapes node range for ${node.id}.`);
            }
        }
    }

    return {
        ok: issues.length === 0,
        issues,
    };
}

export function buildDelimiterAccountingProof(source: string): DelimiterAccountingProof {
    const document = parseMarkdownProofOfConcept(source);
    const entries: DelimiterAccountingEntry[] = [];
    const consumedRanges: SourceRange[] = [];

    for (const block of document.blocks) {
        for (const token of block.inlineTokens) {
            if (token.kind !== "strong" && token.kind !== "emphasis" && token.kind !== "strikethrough") {
                continue;
            }

            if (rangesOverlapAny(token.range, consumedRanges)) {
                continue;
            }

            // The PoC records only the outer consumed delimiter pair so later invariants can distinguish it from literal leftovers.
            const delimiterLength = token.kind === "emphasis" ? 1 : 2;
            const delimiter = token.source.slice(0, delimiterLength);
            const opener = createRange(token.range.start, token.range.start + delimiterLength);
            const closer = createRange(token.range.end - delimiterLength, token.range.end);
            const content = createRange(opener.end, closer.start);

            entries.push({
                kind: token.kind,
                delimiter,
                opener,
                closer,
                content,
                source: token.source,
            });
            consumedRanges.push(opener, closer);
        }
    }

    const literalDelimiterRanges: SourceRange[] = [];

    for (let index = 0; index < source.length; index += 1) {
        if (!DELIMITER_CHARACTERS.has(source[index])) {
            continue;
        }

        if (isCoveredByRanges(index, consumedRanges)) {
            continue;
        }

        let end = index + 1;
        while (end < source.length && source[end] === source[index] && !isCoveredByRanges(end, consumedRanges)) {
            end += 1;
        }

        literalDelimiterRanges.push(createRange(index, end));
        index = end - 1;
    }

    return {
        source,
        entries,
        literalDelimiterRanges,
    };
}

export function buildRecoveryRegionProofs(source: string): RecoveryRegionProof[] {
    const proofs: RecoveryRegionProof[] = [];
    const blockDocument = parseBlocksProofOfConcept(source);

    for (const block of blockDocument.blocks) {
        // Unclosed fences and raw HTML are surfaced as proof-only recovery/opaque regions until the full CST exists.
        if (block.kind === "fencedCode" && block.metadata.closed === false) {
            proofs.push({
                kind: "recovery",
                reason: "unclosedFence",
                range: block.range,
                source: source.slice(block.range.start, block.range.end),
                incomplete: true,
            });
        }

        if (block.kind === "paragraph" && /^\s*</.test(block.source.trimStart())) {
            proofs.push({
                kind: "opaque",
                reason: "rawHtml",
                range: block.range,
                source: source.slice(block.range.start, block.range.end),
                incomplete: false,
            });
        }
    }

    const partialLinkRange = findPartialLinkRange(source);
    if (partialLinkRange) {
        proofs.push({
            kind: "recovery",
            reason: "partialLink",
            range: partialLinkRange,
            source: source.slice(partialLinkRange.start, partialLinkRange.end),
            incomplete: true,
        });
    }

    return proofs.sort((left, right) => left.range.start - right.range.start || left.range.end - right.range.end);
}

function createBlockOwnership(nodeId: string, block: ProofOfConceptBlock, source: string): {
    tokens: CstProofToken[];
    textRanges: SourceRange[];
    segments: CstOwnershipSegment[];
    flags?: CstProofNode["flags"];
} {
    switch (block.kind) {
        case "heading":
            return createPrefixTokenOwnership(nodeId, block, source, /^ {0,3}(#{1,6})(?:\s+|$)/, "headingMarker");
        case "listItem":
            return createPrefixTokenOwnership(nodeId, block, source, /^ {0,3}(?:(?:[*+-])|(?:\d+[.)]))\s+/, "listMarker");
        case "blockquote":
            return createBlockquoteOwnership(nodeId, block, source);
        case "fencedCode":
            return createFencedCodeOwnership(nodeId, block, source);
        case "thematicBreak":
            return createWholeTokenOwnership(nodeId, block, source, "thematicBreak");
        default:
            return createWholeTextOwnership(nodeId, block, source, block.kind === "opaque" ? { opaque: true } : undefined);
    }
}

function createWholeTextOwnership(
    nodeId: string,
    block: ProofOfConceptBlock,
    source: string,
    flags?: CstProofNode["flags"]
): {
    tokens: CstProofToken[];
    textRanges: SourceRange[];
    segments: CstOwnershipSegment[];
    flags?: CstProofNode["flags"];
} {
    return {
        tokens: [],
        textRanges: [block.range],
        segments: [createSegment(flags?.opaque ? "opaque" : "text", nodeId, block.kind, block.range.start, block.range.end, source)],
        flags,
    };
}

function createWholeTokenOwnership(nodeId: string, block: ProofOfConceptBlock, source: string, tokenKind: string) {
    const token = createToken(tokenKind, block.range.start, block.range.end, source);

    return {
        tokens: [token],
        textRanges: [],
        segments: [createSegment("token", nodeId, tokenKind, token.range.start, token.range.end, source)],
    };
}

function createPrefixTokenOwnership(nodeId: string, block: ProofOfConceptBlock, source: string, pattern: RegExp, tokenKind: string) {
    const match = block.source.match(pattern);

    if (!match) {
        return createWholeTextOwnership(nodeId, block, source);
    }

    const tokenEnd = block.range.start + match[0].length;
    const token = createToken(tokenKind, block.range.start, tokenEnd, source);
    const textRanges = tokenEnd < block.range.end ? [createRange(tokenEnd, block.range.end)] : [];
    const segments: CstOwnershipSegment[] = [createSegment("token", nodeId, tokenKind, token.range.start, token.range.end, source)];

    for (const textRange of textRanges) {
        segments.push(createSegment("text", nodeId, `${block.kind}Text`, textRange.start, textRange.end, source));
    }

    return {
        tokens: [token],
        textRanges,
        segments,
    };
}

function createBlockquoteOwnership(nodeId: string, block: ProofOfConceptBlock, source: string) {
    const tokens: CstProofToken[] = [];
    const textRanges: SourceRange[] = [];
    const segments: CstOwnershipSegment[] = [];

    for (const line of splitRawLines(block.source, block.range.start)) {
        const match = line.text.match(/^( {0,3}> ?)+/);

        if (!match) {
            const textRange = createRange(line.start, line.end);
            textRanges.push(textRange);
            segments.push(createSegment("text", nodeId, "blockquoteText", textRange.start, textRange.end, source));
            continue;
        }

        const tokenRange = createRange(line.start, line.start + match[0].length);
        tokens.push(createToken("blockquoteMarker", tokenRange.start, tokenRange.end, source));
        segments.push(createSegment("token", nodeId, "blockquoteMarker", tokenRange.start, tokenRange.end, source));

        if (tokenRange.end < line.end) {
            const textRange = createRange(tokenRange.end, line.end);
            textRanges.push(textRange);
            segments.push(createSegment("text", nodeId, "blockquoteText", textRange.start, textRange.end, source));
        }
    }

    return {
        tokens,
        textRanges,
        segments,
    };
}

function createFencedCodeOwnership(nodeId: string, block: ProofOfConceptBlock, source: string) {
    const lines = splitRawLines(block.source, block.range.start);
    const tokens: CstProofToken[] = [];
    const textRanges: SourceRange[] = [];
    const segments: CstOwnershipSegment[] = [];

    if (lines.length === 0) {
        return {
            tokens,
            textRanges,
            segments,
        };
    }

    const openingLine = lines[0];
    tokens.push(createToken("fenceOpen", openingLine.start, openingLine.end, source));
    segments.push(createSegment("token", nodeId, "fenceOpen", openingLine.start, openingLine.end, source));

    const closingLine = block.metadata.closed === false ? undefined : lines.length > 1 ? lines[lines.length - 1] : undefined;
    const bodyStartIndex = 1;
    const bodyEndIndex = closingLine ? lines.length - 1 : lines.length;

    for (let index = bodyStartIndex; index < bodyEndIndex; index += 1) {
        const textRange = createRange(lines[index].start, lines[index].end);
        textRanges.push(textRange);
        segments.push(createSegment("text", nodeId, "fencedCodeBody", textRange.start, textRange.end, source));
    }

    if (closingLine) {
        tokens.push(createToken("fenceClose", closingLine.start, closingLine.end, source));
        segments.push(createSegment("token", nodeId, "fenceClose", closingLine.start, closingLine.end, source));
    }

    return {
        tokens,
        textRanges,
        segments,
        flags: block.metadata.closed === false ? { incomplete: true, recovery: true } : undefined,
    };
}

function splitRawLines(source: string, baseOffset: number): RawLine[] {
    const lines: RawLine[] = [];
    let start = 0;

    for (let index = 0; index < source.length; index += 1) {
        if (source[index] === "\n") {
            const raw = source.slice(start, index + 1);
            lines.push(createRawLine(raw, baseOffset + start));
            start = index + 1;
        }
    }

    if (start < source.length) {
        lines.push(createRawLine(source.slice(start), baseOffset + start));
    }

    return lines;
}

function createRawLine(raw: string, start: number): RawLine {
    const text = raw.endsWith("\r\n") ? raw.slice(0, -2) : raw.endsWith("\n") ? raw.slice(0, -1) : raw;

    return {
        raw,
        text,
        start,
        end: start + raw.length,
    };
}

function findPartialLinkRange(source: string): SourceRange | null {
    const lines = source.split(/(?<=\n)/);
    let offset = 0;

    for (const line of lines) {
        const openBracketIndex = line.indexOf("[");
        const hasClosedLink = /\[[^\]]+\]\([^\)]+\)/.test(line);

        if (openBracketIndex !== -1 && !hasClosedLink) {
            return createRange(offset + openBracketIndex, offset + line.length);
        }

        offset += line.length;
    }

    return null;
}

function isCoveredByRanges(index: number, ranges: SourceRange[]): boolean {
    return ranges.some((range) => index >= range.start && index < range.end);
}

function rangesOverlapAny(range: SourceRange, ranges: SourceRange[]): boolean {
    return ranges.some((existing) => range.start < existing.end && range.end > existing.start);
}

function createToken(kind: string, start: number, end: number, source: string): CstProofToken {
    return {
        kind,
        range: createRange(start, end),
        source: source.slice(start, end),
    };
}

function createSegment(
    kind: CstOwnershipSegment["kind"],
    ownerId: string,
    label: string,
    start: number,
    end: number,
    source: string
): CstOwnershipSegment {
    return {
        kind,
        ownerId,
        label,
        range: createRange(start, end),
        source: source.slice(start, end),
    };
}

function createRange(start: number, end: number): SourceRange {
    return { start, end };
}
