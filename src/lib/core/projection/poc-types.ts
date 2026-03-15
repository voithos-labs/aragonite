/**
 * Read-only view projection types for the editor proof of concept.
 */
import type { SourceRange } from "../types.js";
import type { InputHarnessAtomKind, InputHarnessBlockRole } from "../input/poc-types.js";
import type { ProofOfConceptBlockKind, ProofOfConceptBlockMetadata } from "../parser/poc-types.js";

export type ViewProjectionMark = Exclude<
    | "emphasis"
    | "strong"
    | "strikethrough"
    | "inlineCode"
    | "link"
    | "image"
    | "autolink",
    "image"
>;

export interface ViewProjectionContainerContext {
    listDepth: number;
    quoteDepth: number;
    listKind?: "ordered" | "unordered";
    taskItem?: boolean;
    taskChecked?: boolean;
}

export interface ViewProjectionAtomicInlineDescriptor {
    kind: InputHarnessAtomKind;
    source: string;
}

export interface ViewProjectionInlineRun {
    key: string;
    partKey: string;
    text: string;
    sourceRange: SourceRange;
    source: string;
    marks: ViewProjectionMark[];
    editable: boolean;
    atomic?: ViewProjectionAtomicInlineDescriptor;
}

export interface ViewProjectionBlockDescriptor {
    key: string;
    blockKey: string;
    blockIndex: number;
    kind: ProofOfConceptBlockKind;
    role: InputHarnessBlockRole;
    depth: number;
    containerContext: ViewProjectionContainerContext;
    metadata: Partial<ProofOfConceptBlockMetadata>;
    editable: boolean;
    runs: ViewProjectionInlineRun[];
    rawSource?: string;
}

export interface ViewProjectionDocument {
    source: string;
    blocks: ViewProjectionBlockDescriptor[];
}
