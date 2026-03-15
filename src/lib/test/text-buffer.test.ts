/**
 * Smoke tests for the editor text buffer and file metadata helpers.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
    analyzeDocumentText,
    normalizeLineEndings,
    normalizeTextInsertion,
    serializeDocumentText,
} from "../core/file-metadata.js";
import { TextBuffer } from "../core/text-buffer.js";

test("analyzeDocumentText strips a BOM and captures file metadata", () => {
    const result = analyzeDocumentText("\uFEFFalpha\r\nbeta\r\n");

    assert.equal(result.text, "alpha\r\nbeta\r\n");
    assert.deepEqual(result.metadata, {
        hasBom: true,
        lineEnding: "\r\n",
        hasFinalNewline: true,
    });
});

test("normalize line endings uses the preferred insertion style", () => {
    assert.equal(normalizeLineEndings("a\r\nb\nc\rd", "\n"), "a\nb\nc\nd");
    assert.equal(normalizeTextInsertion("a\r\nb\nc\rd", { lineEnding: "\r\n" }), "a\r\nb\r\nc\r\nd");
});

test("serializeDocumentText reapplies the stored BOM without rewriting content", () => {
    assert.equal(serializeDocumentText("alpha\nbeta", { hasBom: true }), "\uFEFFalpha\nbeta");
    assert.equal(serializeDocumentText("alpha\r\nbeta", { hasBom: false }), "alpha\r\nbeta");
});

test("TextBuffer exposes stable line and position lookups", () => {
    const buffer = new TextBuffer("alpha\r\nbeta\n");

    assert.equal(buffer.length, 12);
    assert.equal(buffer.lineCount, 3);
    assert.equal(buffer.getLine(0), "alpha");
    assert.equal(buffer.getLine(1), "beta");
    assert.equal(buffer.getLine(2), "");
    assert.equal(buffer.getLineStartOffset(1), 7);
    assert.equal(buffer.getLineEndOffset(1), 11);
    assert.deepEqual(buffer.positionAt(0), { line: 0, column: 0, offset: 0 });
    assert.deepEqual(buffer.positionAt(5), { line: 0, column: 5, offset: 5 });
    assert.deepEqual(buffer.positionAt(6), { line: 0, column: 5, offset: 6 });
    assert.deepEqual(buffer.positionAt(8), { line: 1, column: 1, offset: 8 });
    assert.equal(buffer.offsetAt(0, 99), 5);
    assert.equal(buffer.offsetAt(1, 2), 9);
    assert.equal(buffer.clampOffset(-10), 0);
    assert.equal(buffer.clampOffset(999), 12);
});

test("TextBuffer replaceRange mutates text and rebuilds line indexes", () => {
    const buffer = new TextBuffer("hello\nworld");
    const insertedRange = buffer.replaceRange({ start: 5, end: 6 }, "\r\nwide\r\n");

    assert.deepEqual(insertedRange, { start: 5, end: 13 });
    assert.equal(buffer.toString(), "hello\r\nwide\r\nworld");
    assert.equal(buffer.lineCount, 3);
    assert.equal(buffer.getLine(0), "hello");
    assert.equal(buffer.getLine(1), "wide");
    assert.equal(buffer.getLine(2), "world");
});
