/**
 * Smoke tests for the Phase 0 input and selection harness proof of concept.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
    applyInputHarnessBeforeInputIntent,
    buildInputHarnessProofOfConcept,
    createCollapsedInputHarnessTextSelection,
    createInputHarnessNodeSelection,
    createInputHarnessTextSelection,
    findFirstInputHarnessBlockByRole,
    type InputHarnessBlockDescriptor,
    type InputHarnessInlinePart,
    mapInputHarnessLogicalSelectionToDomSelection,
    pasteIntoInputHarnessSelection,
    reconcileInputHarnessDomSelection,
    repairInputHarnessDomSelection,
    serializeInputHarnessSelection,
    startInputHarnessComposition,
    updateInputHarnessComposition,
    commitInputHarnessComposition,
} from "../core/index.js";
import { MIXED_GFM_FIXTURE } from "./fixtures/mixed-gfm-fixture.js";

test("Phase 0 input harness PoC exposes the required editable islands", () => {
    const document = buildInputHarnessProofOfConcept(MIXED_GFM_FIXTURE);

    assert.equal(findFirstInputHarnessBlockByRole(document, "paragraph")?.editable, true);
    assert.equal(findFirstInputHarnessBlockByRole(document, "heading")?.editable, true);
    assert.equal(findFirstInputHarnessBlockByRole(document, "listItem")?.editable, true);
    assert.equal(findFirstInputHarnessBlockByRole(document, "blockquote")?.editable, true);
    assert.equal(findFirstInputHarnessBlockByRole(document, "fencedCode")?.editable, true);
    assert.equal(findFirstInputHarnessBlockByRole(document, "thematicBreak")?.editable, false);
});

test("Phase 0 input harness PoC round-trips a paragraph logical selection through DOM mapping", () => {
    const document = buildInputHarnessProofOfConcept(MIXED_GFM_FIXTURE);
    const paragraphBlock = findFirstInputHarnessBlockByRole(document, "paragraph");

    assert.equal(paragraphBlock !== undefined, true);

    const selection = createInputHarnessTextSelection(document, paragraphBlock!.key, 10, 20);
    const domSelection = mapInputHarnessLogicalSelectionToDomSelection(document, selection);
    const reconciled = reconcileInputHarnessDomSelection(document, domSelection);

    assert.deepEqual(reconciled, selection);
});

test("Phase 0 input harness PoC repairs heading chrome selections into logical text positions", () => {
    const document = buildInputHarnessProofOfConcept(MIXED_GFM_FIXTURE);
    const headingBlock = findFirstInputHarnessBlockByRole(document, "heading");

    assert.equal(headingBlock !== undefined, true);

    const repaired = repairInputHarnessDomSelection(document, {
        anchor: {
            blockKey: headingBlock!.key,
            partKey: "chrome:start",
            kind: "chrome",
            offset: 0,
        },
        focus: {
            blockKey: headingBlock!.key,
            partKey: "chrome:start",
            kind: "chrome",
            offset: 0,
        },
    });

    const logical = reconcileInputHarnessDomSelection(document, repaired);
    assert.equal(logical.anchor.kind, "text");
    assert.equal(logical.anchor.kind === "text" ? logical.anchor.textOffset : -1, 0);
});

test("Phase 0 input harness PoC preserves image atoms as node selections", () => {
    const document = buildInputHarnessProofOfConcept(MIXED_GFM_FIXTURE);
    const imageBlock = document.blocks.find((block: InputHarnessBlockDescriptor) =>
        block.parts.some((part: InputHarnessInlinePart) => part.kind === "atom")
    );

    assert.equal(imageBlock !== undefined, true);

    const imageAtom = imageBlock!.parts.find((part: InputHarnessInlinePart) => part.kind === "atom");
    assert.equal(imageAtom !== undefined, true);

    const selection = createInputHarnessNodeSelection(document, imageAtom!.key);
    const domSelection = mapInputHarnessLogicalSelectionToDomSelection(document, selection);
    const reconciled = reconcileInputHarnessDomSelection(document, domSelection);

    assert.equal(selection.kind, "node");
    assert.equal(reconciled.kind, "node");
    assert.equal(serializeInputHarnessSelection(document, selection), "![alt](image.png)");
});

test("Phase 0 input harness PoC commits IME-like composition inside a fenced code block", () => {
    const document = buildInputHarnessProofOfConcept(MIXED_GFM_FIXTURE);
    const codeBlock = findFirstInputHarnessBlockByRole(document, "fencedCode");

    assert.equal(codeBlock !== undefined, true);

    const insertionPoint = Math.max(0, codeBlock!.textLength - 1);
    const selection = createCollapsedInputHarnessTextSelection(document, codeBlock!.key, insertionPoint);
    const session = updateInputHarnessComposition(startInputHarnessComposition(document, selection), " // かな");
    const mutation = commitInputHarnessComposition(document, session, session.previewText);

    assert.equal(mutation.source.includes('console.log("hello"); // かな\n```'), true);
    assert.equal(findFirstInputHarnessBlockByRole(mutation.document, "fencedCode")?.editable, true);
});

test("Phase 0 input harness PoC normalizes pasted line endings and keeps logical selection canonical", () => {
    const document = buildInputHarnessProofOfConcept("Paragraph\r\n", { lineEnding: "\r\n" });
    const paragraphBlock = findFirstInputHarnessBlockByRole(document, "paragraph");

    assert.equal(paragraphBlock !== undefined, true);

    const selection = createCollapsedInputHarnessTextSelection(document, paragraphBlock!.key, paragraphBlock!.textLength);
    const mutation = pasteIntoInputHarnessSelection(document, selection, "\nSecond line\nThird line");

    assert.equal(mutation.source, "Paragraph\r\nSecond line\r\nThird line\r\n");
    assert.equal(mutation.selection.anchor.kind, "text");
    assert.equal(mutation.selection.anchor.sourceOffset, mutation.selection.focus.sourceOffset);
});

test("Phase 0 input harness PoC translates insertText beforeinput into a text mutation", () => {
    const document = buildInputHarnessProofOfConcept("Hello world\n");
    const paragraphBlock = findFirstInputHarnessBlockByRole(document, "paragraph");

    assert.equal(paragraphBlock !== undefined, true);

    const selection = createCollapsedInputHarnessTextSelection(document, paragraphBlock!.key, 5);
    const outcome = applyInputHarnessBeforeInputIntent(document, selection, {
        inputType: "insertText",
        data: ",",
    });

    assert.equal(outcome.kind, "mutation");
    if (outcome.kind !== "mutation") {
        return;
    }

    assert.equal(outcome.mutation.source, "Hello, world\n");
    assert.equal(outcome.mutation.selection.anchor.kind, "text");
    assert.equal(outcome.mutation.selection.anchor.sourceOffset, 6);
});

test("Phase 0 input harness PoC translates deleteContentBackward into a local text deletion", () => {
    const document = buildInputHarnessProofOfConcept("Hello world\n");
    const paragraphBlock = findFirstInputHarnessBlockByRole(document, "paragraph");

    assert.equal(paragraphBlock !== undefined, true);

    const selection = createCollapsedInputHarnessTextSelection(document, paragraphBlock!.key, 5);
    const outcome = applyInputHarnessBeforeInputIntent(document, selection, {
        inputType: "deleteContentBackward",
    });

    assert.equal(outcome.kind, "mutation");
    if (outcome.kind !== "mutation") {
        return;
    }

    assert.equal(outcome.mutation.source, "Hell world\n");
    assert.equal(outcome.mutation.selection.anchor.kind, "text");
    assert.equal(outcome.mutation.selection.anchor.sourceOffset, 4);
});

test("Phase 0 input harness PoC selects an image atom when backspace lands on its boundary", () => {
    const document = buildInputHarnessProofOfConcept(MIXED_GFM_FIXTURE);
    const imageBlock = document.blocks.find((block: InputHarnessBlockDescriptor) =>
        block.parts.some((part: InputHarnessInlinePart) => part.kind === "atom")
    );

    assert.equal(imageBlock !== undefined, true);

    const imageAtom = imageBlock!.parts.find((part: InputHarnessInlinePart) => part.kind === "atom");
    assert.equal(imageAtom !== undefined, true);

    const selection = reconcileInputHarnessDomSelection(document, {
        anchor: {
            blockKey: imageBlock!.key,
            partKey: imageAtom!.key,
            kind: "atom",
            offset: 0,
            side: "after",
        },
        focus: {
            blockKey: imageBlock!.key,
            partKey: imageAtom!.key,
            kind: "atom",
            offset: 0,
            side: "after",
        },
    });
    const outcome = applyInputHarnessBeforeInputIntent(document, selection, {
        inputType: "deleteContentBackward",
    });

    assert.equal(outcome.kind, "selection");
    if (outcome.kind !== "selection") {
        return;
    }

    assert.equal(outcome.selection.kind, "node");
    assert.equal(outcome.selection.selectedAtomKey, imageAtom!.key);
});
