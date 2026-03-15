/****
 * Headless types for the Phase 0 input and selection harness proof of concept.
 ****/
import type { FileEncodingMetadata, SourceRange } from "../types.js";
import type {
    ProofOfConceptBlock,
    ProofOfConceptBlockKind,
    ProofOfConceptDocument,
} from "../parser/poc-types.js";

export type InputHarnessBlockRole =
    | "paragraph"
    | "heading"
    | "listItem"
    | "blockquote"
    | "fencedCode"
    | "thematicBreak"
    | "opaque";

export type InputHarnessAtomKind = "image";
export type InputHarnessDomPointKind = "text" | "atom" | "chrome";
export type InputHarnessAtomSide = "before" | "after";
export type InputHarnessSelectionKind = "text" | "node";
export type InputHarnessSelectionDirection = "forward" | "backward";

export interface InputHarnessTextPart {
    kind: "text";
    key: string;
    sourceRange: SourceRange;
    text: string;
    textStart: number;
    textEnd: number;
}

export interface InputHarnessAtomPart {
    kind: "atom";
    key: string;
    atomKind: InputHarnessAtomKind;
    sourceRange: SourceRange;
    source: string;
    textStart: number;
    textEnd: number;
}

export type InputHarnessInlinePart = InputHarnessTextPart | InputHarnessAtomPart;

export interface InputHarnessBlockDescriptor {
    key: string;
    blockIndex: number;
    kind: ProofOfConceptBlockKind;
    role: InputHarnessBlockRole;
    block: ProofOfConceptBlock;
    editable: boolean;
    parts: InputHarnessInlinePart[];
    textLength: number;
}

export interface InputHarnessDocument {
    source: string;
    metadata: Pick<FileEncodingMetadata, "lineEnding">;
    parsed: ProofOfConceptDocument;
    blocks: InputHarnessBlockDescriptor[];
}

export interface InputHarnessLogicalTextPosition {
    kind: "text";
    blockKey: string;
    sourceOffset: number;
    textOffset: number;
}

export interface InputHarnessLogicalAtomPosition {
    kind: "atom";
    blockKey: string;
    atomKey: string;
    sourceOffset: number;
    side: InputHarnessAtomSide;
}

export type InputHarnessLogicalPosition = InputHarnessLogicalTextPosition | InputHarnessLogicalAtomPosition;

export interface InputHarnessSelection {
    kind: InputHarnessSelectionKind;
    anchor: InputHarnessLogicalPosition;
    focus: InputHarnessLogicalPosition;
    direction: InputHarnessSelectionDirection;
    selectedAtomKey?: string;
}

export interface InputHarnessDomPoint {
    blockKey: string;
    partKey: string;
    kind: InputHarnessDomPointKind;
    offset: number;
    side?: InputHarnessAtomSide;
}

export interface InputHarnessDomSelection {
    anchor: InputHarnessDomPoint;
    focus: InputHarnessDomPoint;
}

export interface InputHarnessCompositionSession {
    blockKey: string;
    selection: InputHarnessSelection;
    previewText: string;
}

export interface InputHarnessMutationResult {
    source: string;
    document: InputHarnessDocument;
    selection: InputHarnessSelection;
}
