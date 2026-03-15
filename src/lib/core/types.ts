/**
 * Shared source and document metadata types for the editor core.
 */
export interface SourceRange {
    start: number;
    end: number;
}

export interface SourcePosition {
    line: number;
    column: number;
    offset: number;
}

export type LineEnding = "\n" | "\r\n";

export interface FileEncodingMetadata {
    hasBom: boolean;
    lineEnding: LineEnding;
    hasFinalNewline: boolean;
}

export interface PreparedDocumentText {
    text: string;
    metadata: FileEncodingMetadata;
}
