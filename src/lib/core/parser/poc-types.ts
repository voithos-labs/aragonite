/****
 * Narrow parser types for the Phase 0 editor proof of concept.
 ****/
import type { SourceRange } from "../types.js";

export type ProofOfConceptBlockKind =
    | "heading"
    | "paragraph"
    | "fencedCode"
    | "blockquote"
    | "listItem"
    | "thematicBreak"
    | "opaque";

export type ProofOfConceptInlineTokenKind =
    | "emphasis"
    | "strong"
    | "strikethrough"
    | "inlineCode"
    | "link"
    | "image"
    | "autolink";

export interface ProofOfConceptInlineToken {
    kind: ProofOfConceptInlineTokenKind;
    range: SourceRange;
    source: string;
}

export interface ProofOfConceptBlockMetadata {
    headingLevel?: number;
    fenceMarker?: "`" | "~";
    fenceLength?: number;
    closed?: boolean;
    listMarker?: string;
    ordered?: boolean;
    taskItem?: boolean;
    taskChecked?: boolean;
    thematicMarker?: string;
    quoteDepth?: number;
}

export interface ProofOfConceptBlock {
    kind: ProofOfConceptBlockKind;
    leadingTrivia: string;
    range: SourceRange;
    source: string;
    text: string;
    inlineTokens: ProofOfConceptInlineToken[];
    metadata: ProofOfConceptBlockMetadata;
}

export interface ProofOfConceptDocument {
    source: string;
    prefix: string;
    blocks: ProofOfConceptBlock[];
    suffix: string;
}
