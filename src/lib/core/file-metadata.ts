/**
 * File text analysis and normalization helpers for the editor core.
 */
import type { FileEncodingMetadata, LineEnding, PreparedDocumentText } from "./types.js";

export const BYTE_ORDER_MARK = "\uFEFF";
export const LF = "\n";
export const CRLF = "\r\n";

export function createDefaultFileEncodingMetadata(): FileEncodingMetadata {
    return {
        hasBom: false,
        lineEnding: LF,
        hasFinalNewline: false,
    };
}

export function hasFinalNewline(text: string): boolean {
    return text.endsWith(CRLF) || text.endsWith(LF);
}

export function detectPreferredLineEnding(text: string): LineEnding {
    const firstCrLf = text.indexOf(CRLF);
    const firstLf = text.indexOf(LF);

    if (firstCrLf === -1 && firstLf === -1) {
        return LF;
    }

    if (firstCrLf !== -1 && (firstLf === -1 || firstCrLf <= firstLf)) {
        return CRLF;
    }

    return LF;
}

export function analyzeDocumentText(rawText: string): PreparedDocumentText {
    const hasBom = rawText.startsWith(BYTE_ORDER_MARK);
    const text = hasBom ? rawText.slice(BYTE_ORDER_MARK.length) : rawText;

    return {
        text,
        metadata: {
            hasBom,
            lineEnding: detectPreferredLineEnding(text),
            hasFinalNewline: hasFinalNewline(text),
        },
    };
}

export function normalizeLineEndings(text: string, lineEnding: LineEnding): string {
    const normalized = text.replace(/\r\n|\r|\n/g, LF);

    if (lineEnding === LF) {
        return normalized;
    }

    return normalized.replace(/\n/g, CRLF);
}

export function normalizeTextInsertion(
    text: string,
    metadata: Pick<FileEncodingMetadata, "lineEnding">
): string {
    return normalizeLineEndings(text, metadata.lineEnding);
}

export function serializeDocumentText(
    text: string,
    metadata: Pick<FileEncodingMetadata, "hasBom">
): string {
    return `${metadata.hasBom ? BYTE_ORDER_MARK : ""}${text}`;
}
