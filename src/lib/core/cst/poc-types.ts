/**
 * Types for the Phase 0 CST ownership and recovery proof of concept.
 */
import type { SourceRange } from "../types.js";

export type CstOwnershipSegmentKind =
    | "documentPrefix"
    | "documentSuffix"
    | "leadingTrivia"
    | "token"
    | "text"
    | "recovery"
    | "opaque";

export interface CstOwnershipSegment {
    kind: CstOwnershipSegmentKind;
    ownerId: string;
    label: string;
    range: SourceRange;
    source: string;
}

export interface CstProofToken {
    kind: string;
    range: SourceRange;
    source: string;
}

export interface CstProofNode {
    id: string;
    kind: string;
    range: SourceRange;
    leadingTriviaRange?: SourceRange;
    tokens: CstProofToken[];
    textRanges: SourceRange[];
    flags?: {
        incomplete?: boolean;
        opaque?: boolean;
        recovery?: boolean;
    };
}

export interface CstOwnershipProof {
    source: string;
    nodes: CstProofNode[];
    segments: CstOwnershipSegment[];
}

export interface CstOwnershipValidationResult {
    ok: boolean;
    issues: string[];
}

export interface DelimiterAccountingEntry {
    kind: "strong" | "emphasis" | "strikethrough";
    delimiter: string;
    opener: SourceRange;
    closer: SourceRange;
    content: SourceRange;
    source: string;
}

export interface DelimiterAccountingProof {
    source: string;
    entries: DelimiterAccountingEntry[];
    literalDelimiterRanges: SourceRange[];
}

export interface RecoveryRegionProof {
    kind: "recovery" | "opaque";
    reason: "partialLink" | "unclosedFence" | "rawHtml";
    range: SourceRange;
    source: string;
    incomplete: boolean;
}
