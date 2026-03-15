/**
 * Flat-string text buffer with line indexing for the editor core.
 */
import type { SourcePosition, SourceRange } from "./types.js";

export class TextBuffer {
    private text: string;
    // Line starts are kept eagerly in sync because source offsets are the editor's primary anchor.
    private lineStarts: number[];

    constructor(text = "") {
        this.text = text;
        this.lineStarts = buildLineStarts(text);
    }

    get length(): number {
        return this.text.length;
    }

    get lineCount(): number {
        return this.lineStarts.length;
    }

    clone(): TextBuffer {
        return new TextBuffer(this.text);
    }

    toString(): string {
        return this.text;
    }

    slice(start = 0, end = this.length): string {
        return this.text.slice(this.clampOffset(start), this.clampOffset(end));
    }

    getLine(line: number): string {
        this.assertLine(line);

        const start = this.lineStarts[line];
        const end = this.getLineBreakStartOffset(line);

        return this.text.slice(start, end);
    }

    getLineStartOffset(line: number): number {
        this.assertLine(line);

        return this.lineStarts[line];
    }

    getLineEndOffset(line: number): number {
        this.assertLine(line);

        return this.getLineBreakStartOffset(line);
    }

    positionAt(offset: number): SourcePosition {
        const clampedOffset = this.clampOffset(offset);
        const line = this.findLineIndex(clampedOffset);
        const lineStart = this.lineStarts[line];
        const lineEnd = this.getLineBreakStartOffset(line);

        return {
            line,
            column: Math.min(clampedOffset - lineStart, lineEnd - lineStart),
            offset: clampedOffset,
        };
    }

    offsetAt(line: number, column: number): number {
        this.assertLine(line);

        const lineStart = this.lineStarts[line];
        const lineEnd = this.getLineBreakStartOffset(line);
        const maxColumn = lineEnd - lineStart;
        const clampedColumn = Math.max(0, Math.min(Math.trunc(column), maxColumn));

        return lineStart + clampedColumn;
    }

    replaceRange(range: SourceRange, replacement: string): SourceRange {
        this.assertRange(range);

        this.text = `${this.text.slice(0, range.start)}${replacement}${this.text.slice(range.end)}`;
        this.lineStarts = buildLineStarts(this.text);

        return {
            start: range.start,
            end: range.start + replacement.length,
        };
    }

    clampOffset(offset: number): number {
        if (!Number.isFinite(offset)) {
            throw new RangeError("Offset must be a finite number.");
        }

        return Math.max(0, Math.min(Math.trunc(offset), this.length));
    }

    private assertLine(line: number): void {
        if (!Number.isInteger(line) || line < 0 || line >= this.lineCount) {
            throw new RangeError(`Line ${line} is out of bounds.`);
        }
    }

    private assertRange(range: SourceRange): void {
        if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
            throw new RangeError("Range offsets must be integers.");
        }

        if (range.start < 0 || range.end < 0 || range.start > this.length || range.end > this.length) {
            throw new RangeError("Range is out of bounds.");
        }

        if (range.start > range.end) {
            throw new RangeError("Range start must be less than or equal to range end.");
        }
    }

    private findLineIndex(offset: number): number {
        let low = 0;
        let high = this.lineStarts.length - 1;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const lineStart = this.lineStarts[mid];
            const nextLineStart = mid + 1 < this.lineStarts.length ? this.lineStarts[mid + 1] : this.length + 1;

            if (offset < lineStart) {
                high = mid - 1;
                continue;
            }

            if (offset >= nextLineStart) {
                low = mid + 1;
                continue;
            }

            return mid;
        }

        return this.lineStarts.length - 1;
    }

    private getLineBreakStartOffset(line: number): number {
        if (line === this.lineCount - 1) {
            return this.length;
        }

        const nextLineStart = this.lineStarts[line + 1];

        if (this.text[nextLineStart - 2] === "\r" && this.text[nextLineStart - 1] === "\n") {
            return nextLineStart - 2;
        }

        return nextLineStart - 1;
    }
}

function buildLineStarts(text: string): number[] {
    const lineStarts = [0];

    for (let index = 0; index < text.length; index += 1) {
        if (text[index] === "\r") {
            if (text[index + 1] === "\n") {
                index += 1;
            }

            lineStarts.push(index + 1);
            continue;
        }

        if (text[index] === "\n") {
            lineStarts.push(index + 1);
        }
    }

    return lineStarts;
}
