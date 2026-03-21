/**
 * Headless input and selection harness helpers for the Phase 0 proof of concept.
 */
import { createDefaultFileEncodingMetadata, normalizeTextInsertion } from "../file-metadata.js";
import { parseMarkdownProofOfConcept } from "../parser/poc-parser.js";
import type { ProofOfConceptBlock, ProofOfConceptInlineToken } from "../parser/poc-types.js";
import type { LineEnding, SourceRange } from "../types.js";
import type {
    InputHarnessBeforeInputIntent,
    InputHarnessBeforeInputOutcome,
    InputHarnessAtomPart,
    InputHarnessBlockDescriptor,
    InputHarnessBlockRole,
    InputHarnessCompositionSession,
    InputHarnessDocument,
    InputHarnessDomPoint,
    InputHarnessDomSelection,
    InputHarnessInlinePart,
    InputHarnessLogicalAtomPosition,
    InputHarnessLogicalPosition,
    InputHarnessLogicalTextPosition,
    InputHarnessMutationResult,
    InputHarnessSelection,
    InputHarnessSelectionDirection,
    InputHarnessTextPart,
} from "./poc-types.js";

interface RawLine {
    raw: string;
    text: string;
    lineEnding: string;
    start: number;
    end: number;
}

interface EditableSlice {
    sourceRange: SourceRange;
}

type InputHarnessDeleteDirection = "backward" | "forward";

export function buildInputHarnessProofOfConcept(
    source: string,
    metadata: { lineEnding?: LineEnding } = {}
): InputHarnessDocument {
    const parsed = parseMarkdownProofOfConcept(source);
    const lineEnding = metadata.lineEnding ?? createDefaultFileEncodingMetadata().lineEnding;

    return {
        source,
        metadata: { lineEnding },
        parsed,
        blocks: parsed.blocks.map((block, blockIndex) => buildBlockDescriptor(block, blockIndex)),
    };
}

export function findFirstInputHarnessBlockByRole(
    document: InputHarnessDocument,
    role: InputHarnessBlockRole
): InputHarnessBlockDescriptor | undefined {
    return document.blocks.find((block) => block.role === role);
}

export function createCollapsedInputHarnessTextSelection(
    document: InputHarnessDocument,
    blockKey: string,
    textOffset: number
): InputHarnessSelection {
    return createInputHarnessTextSelection(document, blockKey, textOffset, textOffset);
}

export function createInputHarnessTextSelection(
    document: InputHarnessDocument,
    blockKey: string,
    anchorTextOffset: number,
    focusTextOffset: number
): InputHarnessSelection {
    const block = getBlockByKey(document, blockKey);
    const anchor = resolveTextOffsetToLogicalPosition(block, anchorTextOffset);
    const focus = resolveTextOffsetToLogicalPosition(block, focusTextOffset);

    return createSelection(anchor, focus);
}

export function createInputHarnessNodeSelection(document: InputHarnessDocument, atomKey: string): InputHarnessSelection {
    const atom = getAtomByKey(document, atomKey);
    const anchor: InputHarnessLogicalAtomPosition = {
        kind: "atom",
        blockKey: atom.blockKey,
        atomKey: atom.key,
        side: "before",
        sourceOffset: atom.sourceRange.start,
    };
    const focus: InputHarnessLogicalAtomPosition = {
        kind: "atom",
        blockKey: atom.blockKey,
        atomKey: atom.key,
        side: "after",
        sourceOffset: atom.sourceRange.end,
    };

    return createSelection(anchor, focus, atom.key);
}

export function mapInputHarnessLogicalSelectionToDomSelection(
    document: InputHarnessDocument,
    selection: InputHarnessSelection
): InputHarnessDomSelection {
    return {
        anchor: mapLogicalPositionToDomPoint(document, selection.anchor),
        focus: mapLogicalPositionToDomPoint(document, selection.focus),
    };
}

export function reconcileInputHarnessDomSelection(
    document: InputHarnessDocument,
    domSelection: InputHarnessDomSelection
): InputHarnessSelection {
    const anchor = reconcileDomPointToLogicalPosition(document, domSelection.anchor);
    const focus = reconcileDomPointToLogicalPosition(document, domSelection.focus);

    if (anchor.kind === "atom" && focus.kind === "atom" && anchor.atomKey === focus.atomKey && anchor.side !== focus.side) {
        return createSelection(anchor, focus, anchor.atomKey);
    }

    return createSelection(anchor, focus);
}

export function repairInputHarnessDomSelection(
    document: InputHarnessDocument,
    domSelection: InputHarnessDomSelection
): InputHarnessDomSelection {
    return mapInputHarnessLogicalSelectionToDomSelection(document, reconcileInputHarnessDomSelection(document, domSelection));
}

export function serializeInputHarnessSelection(document: InputHarnessDocument, selection: InputHarnessSelection): string {
    const range = toOrderedSourceRange(selection);

    return document.source.slice(range.start, range.end);
}

export function startInputHarnessComposition(
    document: InputHarnessDocument,
    selection: InputHarnessSelection
): InputHarnessCompositionSession {
    if (selection.kind !== "text") {
        throw new Error("Input harness composition only supports text selections.");
    }

    if (selection.anchor.kind !== "text" || selection.focus.kind !== "text") {
        throw new Error("Input harness composition requires text logical positions.");
    }

    if (selection.anchor.blockKey !== selection.focus.blockKey) {
        throw new Error("Input harness composition must stay within a single editable block.");
    }

    const block = getBlockByKey(document, selection.anchor.blockKey);
    if (!block.editable) {
        throw new Error(`Block ${block.key} is not editable in the input harness.`);
    }

    return {
        blockKey: block.key,
        selection,
        previewText: "",
    };
}

export function updateInputHarnessComposition(
    session: InputHarnessCompositionSession,
    previewText: string
): InputHarnessCompositionSession {
    return {
        ...session,
        previewText,
    };
}

export function commitInputHarnessComposition(
    document: InputHarnessDocument,
    session: InputHarnessCompositionSession,
    finalText: string
): InputHarnessMutationResult {
    return replaceInputHarnessSelection(document, session.selection, finalText);
}

export function pasteIntoInputHarnessSelection(
    document: InputHarnessDocument,
    selection: InputHarnessSelection,
    text: string
): InputHarnessMutationResult {
    return replaceInputHarnessSelection(document, selection, normalizeTextInsertion(text, document.metadata));
}

/**
 * Translates a narrow browser `beforeinput` intent into a headless selection update or mutation.
 */
export function applyInputHarnessBeforeInputIntent(
    document: InputHarnessDocument,
    selection: InputHarnessSelection,
    intent: InputHarnessBeforeInputIntent
): InputHarnessBeforeInputOutcome {
    if (selection.anchor.blockKey !== selection.focus.blockKey) {
        return {
            kind: "unsupported",
            reason: "Phase 0 beforeinput handling only supports selections that stay within a single block.",
        };
    }

    switch (intent.inputType) {
        case "insertText": {
            if (typeof intent.data !== "string") {
                return {
                    kind: "unsupported",
                    reason: "insertText requires text data.",
                };
            }

            return {
                kind: "mutation",
                mutation: replaceInputHarnessSelection(document, selection, intent.data),
            };
        }
        case "insertFromPaste": {
            if (typeof intent.data !== "string") {
                return {
                    kind: "unsupported",
                    reason: "insertFromPaste requires plain-text clipboard data.",
                };
            }

            return {
                kind: "mutation",
                mutation: pasteIntoInputHarnessSelection(document, selection, intent.data),
            };
        }
        case "insertParagraph":
        case "insertLineBreak":
            return applyLineBreakIntent(document, selection);
        case "deleteContentBackward":
            return applyDeletionIntent(document, selection, "backward");
        case "deleteContentForward":
            return applyDeletionIntent(document, selection, "forward");
    }

    return {
        kind: "unsupported",
        reason: `Phase 0 does not recognize beforeinput intent ${intent.inputType}.`,
    };
}

function replaceInputHarnessSelection(
    document: InputHarnessDocument,
    selection: InputHarnessSelection,
    insertedText: string
): InputHarnessMutationResult {
    const range = toOrderedSourceRange(selection);
    const source = `${document.source.slice(0, range.start)}${insertedText}${document.source.slice(range.end)}`;
    const nextDocument = buildInputHarnessProofOfConcept(source, document.metadata);
    const nextSelection = createSelection(
        resolveSourceOffsetToLogicalPosition(nextDocument, range.start + insertedText.length),
        resolveSourceOffsetToLogicalPosition(nextDocument, range.start + insertedText.length)
    );

    return {
        source,
        document: nextDocument,
        selection: nextSelection,
    };
}

function applyLineBreakIntent(
    document: InputHarnessDocument,
    selection: InputHarnessSelection
): InputHarnessBeforeInputOutcome {
    if (selection.kind === "node") {
        return {
            kind: "unsupported",
            reason: "Phase 0 Enter handling only supports text selections.",
        };
    }

    const block = getBlockByKey(document, selection.anchor.blockKey);
    if (block.role !== "fencedCode") {
        return {
            kind: "unsupported",
            reason: "Phase 0 does not yet split supported blocks on Enter outside fenced code.",
        };
    }

    return {
        kind: "mutation",
        mutation: replaceInputHarnessSelection(document, selection, normalizeTextInsertion("\n", document.metadata)),
    };
}

function buildBlockDescriptor(block: ProofOfConceptBlock, blockIndex: number): InputHarnessBlockDescriptor {
    const key = `block:${blockIndex}:${block.kind}`;
    const role = block.kind;
    const editable = role !== "thematicBreak" && role !== "opaque";
    const slices = buildEditableSlices(block);
    const parts = buildInlineParts(key, block, slices, editable);
    const textLength = parts.length === 0 ? 0 : parts[parts.length - 1].textEnd;

    return {
        key,
        blockIndex,
        kind: block.kind,
        role,
        block,
        editable,
        parts,
        textLength,
    };
}

function buildEditableSlices(block: ProofOfConceptBlock): EditableSlice[] {
    switch (block.kind) {
        case "paragraph":
            return [createTrimmedBlockSlice(block)];
        case "heading":
            return [createHeadingSlice(block)];
        case "listItem":
            return [createListItemSlice(block)];
        case "blockquote":
            return createBlockquoteSlices(block);
        case "fencedCode":
            return [createFencedCodeBodySlice(block)];
        default:
            return [];
    }
}

function createTrimmedBlockSlice(block: ProofOfConceptBlock): EditableSlice {
    const trimmed = trimTrailingLineEnding(block.source);

    return {
        sourceRange: {
            start: block.range.start,
            end: block.range.start + trimmed.length,
        },
    };
}

function createHeadingSlice(block: ProofOfConceptBlock): EditableSlice {
    const trimmed = trimTrailingLineEnding(block.source);
    const prefix = trimmed.match(/^ {0,3}(#{1,6})(?:\s+|$)/)?.[0] ?? "";

    return {
        sourceRange: {
            start: block.range.start + prefix.length,
            end: block.range.start + trimmed.length,
        },
    };
}

function createListItemSlice(block: ProofOfConceptBlock): EditableSlice {
    const trimmed = trimTrailingLineEnding(block.source);
    const prefix = trimmed.match(/^ {0,3}((?:[*+-])|(?:\d+[.)]))\s+/)?.[0] ?? "";

    return {
        sourceRange: {
            start: block.range.start + prefix.length,
            end: block.range.start + trimmed.length,
        },
    };
}

function createBlockquoteSlices(block: ProofOfConceptBlock): EditableSlice[] {
    const lines = splitLinesWithOffsets(block.source, block.range.start);
    const slices: EditableSlice[] = [];

    for (const line of lines) {
        const prefix = line.text.match(/^( {0,3}> ?)+/)?.[0] ?? "";
        const contentStart = line.start + prefix.length;
        const contentEnd = line.end - line.lineEnding.length;
        slices.push({
            sourceRange: {
                start: contentStart,
                end: contentEnd,
            },
        });

        if (line.lineEnding.length > 0) {
            slices.push({
                sourceRange: {
                    start: contentEnd,
                    end: line.end,
                },
            });
        }
    }

    if (slices.length > 0) {
        const lastSlice = slices[slices.length - 1];
        if (lastSlice.sourceRange.start === lastSlice.sourceRange.end) {
            return slices.slice(0, -1);
        }
    }

    return slices;
}

function createFencedCodeBodySlice(block: ProofOfConceptBlock): EditableSlice {
    const lines = splitLinesWithOffsets(block.source, block.range.start);
    const openLine = lines[0];
    const closed = block.metadata.closed === true;
    const bodyStart = openLine ? openLine.end : block.range.start;
    const bodyEnd = closed && lines.length > 1 ? lines[lines.length - 1].start : block.range.end;

    return {
        sourceRange: {
            start: bodyStart,
            end: Math.max(bodyStart, bodyEnd),
        },
    };
}

function buildInlineParts(
    blockKey: string,
    block: ProofOfConceptBlock,
    slices: EditableSlice[],
    editable: boolean
): InputHarnessInlinePart[] {
    // The Phase 0 harness keeps inline markup as plain text except for image atoms, which need before/after boundaries.
    const imageTokens = block.inlineTokens
        .filter((token) => token.kind === "image")
        .slice()
        .sort((left, right) => left.range.start - right.range.start);
    const parts: InputHarnessInlinePart[] = [];
    let textCursor = 0;
    let imageIndex = 0;

    for (let sliceIndex = 0; sliceIndex < slices.length; sliceIndex += 1) {
        const slice = slices[sliceIndex];
        let cursor = slice.sourceRange.start;

        while (imageIndex < imageTokens.length) {
            const imageToken = imageTokens[imageIndex];

            if (imageToken.range.end <= slice.sourceRange.start) {
                imageIndex += 1;
                continue;
            }

            if (imageToken.range.start >= slice.sourceRange.end) {
                break;
            }

            if (imageToken.range.start > cursor) {
                const text = block.source.slice(cursor - block.range.start, imageToken.range.start - block.range.start);
                parts.push(createTextPart(blockKey, parts.length, cursor, imageToken.range.start, textCursor, text));
                textCursor += text.length;
            }

            parts.push(createAtomPart(blockKey, parts.length, imageToken, textCursor));
            cursor = imageToken.range.end;
            imageIndex += 1;
        }

        if (cursor < slice.sourceRange.end) {
            const text = block.source.slice(cursor - block.range.start, slice.sourceRange.end - block.range.start);
            parts.push(createTextPart(blockKey, parts.length, cursor, slice.sourceRange.end, textCursor, text));
            textCursor += text.length;
        }
    }

    if (editable && parts.length === 0) {
        const fallbackStart = slices[0]?.sourceRange.start ?? block.range.start;
        parts.push(createTextPart(blockKey, 0, fallbackStart, fallbackStart, 0, ""));
    }

    return parts;
}

function createTextPart(
    blockKey: string,
    index: number,
    sourceStart: number,
    sourceEnd: number,
    textStart: number,
    text: string
): InputHarnessTextPart {
    return {
        kind: "text",
        key: `${blockKey}:text:${index}`,
        sourceRange: { start: sourceStart, end: sourceEnd },
        text,
        textStart,
        textEnd: textStart + text.length,
    };
}

function createAtomPart(
    blockKey: string,
    index: number,
    token: ProofOfConceptInlineToken,
    textStart: number
): InputHarnessAtomPart {
    return {
        kind: "atom",
        key: `${blockKey}:atom:${index}`,
        atomKind: "image",
        sourceRange: token.range,
        source: token.source,
        textStart,
        textEnd: textStart,
    };
}

function mapLogicalPositionToDomPoint(document: InputHarnessDocument, position: InputHarnessLogicalPosition): InputHarnessDomPoint {
    const block = getBlockByKey(document, position.blockKey);

    if (position.kind === "atom") {
        return {
            blockKey: block.key,
            partKey: position.atomKey,
            kind: "atom",
            offset: 0,
            side: position.side,
        };
    }

    const textPart = getTextPartForTextOffset(block, position.textOffset);
    const offset = position.textOffset - textPart.textStart;

    return {
        blockKey: block.key,
        partKey: textPart.key,
        kind: "text",
        offset,
    };
}

function reconcileDomPointToLogicalPosition(document: InputHarnessDocument, domPoint: InputHarnessDomPoint): InputHarnessLogicalPosition {
    const block = getBlockByKey(document, domPoint.blockKey);

    if (domPoint.kind === "chrome") {
        return domPoint.offset <= 0 ? resolveTextOffsetToLogicalPosition(block, 0) : resolveTextOffsetToLogicalPosition(block, block.textLength);
    }

    const part = getPartByKey(block, domPoint.partKey);
    if (part.kind === "atom") {
        return {
            kind: "atom",
            blockKey: block.key,
            atomKey: part.key,
            side: domPoint.side ?? "before",
            sourceOffset: domPoint.side === "after" ? part.sourceRange.end : part.sourceRange.start,
        };
    }

    const clampedOffset = clamp(domPoint.offset, 0, part.text.length);
    const sourceOffset = clampedOffset === part.text.length ? part.sourceRange.end : part.sourceRange.start + clampedOffset;

    return {
        kind: "text",
        blockKey: block.key,
        sourceOffset,
        textOffset: part.textStart + clampedOffset,
    };
}

function resolveTextOffsetToLogicalPosition(
    block: InputHarnessBlockDescriptor,
    requestedTextOffset: number
): InputHarnessLogicalTextPosition {
    const clampedTextOffset = clamp(requestedTextOffset, 0, block.textLength);
    const part = getTextPartForTextOffset(block, clampedTextOffset);
    const partOffset = clamp(clampedTextOffset - part.textStart, 0, part.text.length);
    const sourceOffset = partOffset === part.text.length ? part.sourceRange.end : part.sourceRange.start + partOffset;

    return {
        kind: "text",
        blockKey: block.key,
        sourceOffset,
        textOffset: clampedTextOffset,
    };
}

function resolveSourceOffsetToLogicalPosition(
    document: InputHarnessDocument,
    requestedSourceOffset: number
): InputHarnessLogicalPosition {
    const sourceOffset = clamp(requestedSourceOffset, 0, document.source.length);

    for (const block of document.blocks) {
        if (!block.editable) {
            continue;
        }

        if (block.parts.length === 0) {
            continue;
        }

        const firstPart = block.parts[0];
        const lastPart = block.parts[block.parts.length - 1];

        if (sourceOffset < firstPart.sourceRange.start || sourceOffset > lastPart.sourceRange.end) {
            continue;
        }

        return resolveSourceOffsetWithinBlock(block, sourceOffset);
    }

    const editableBlocks = document.blocks.filter((block) => block.editable && block.parts.length > 0);
    if (editableBlocks.length === 0) {
        throw new Error("The input harness document has no editable blocks.");
    }

    const firstEditableBlock = editableBlocks[0];
    const lastEditableBlock = editableBlocks[editableBlocks.length - 1];
    if (sourceOffset <= firstEditableBlock.parts[0].sourceRange.start) {
        return resolveTextOffsetToLogicalPosition(firstEditableBlock, 0);
    }

    return resolveTextOffsetToLogicalPosition(lastEditableBlock, lastEditableBlock.textLength);
}

function resolveSourceOffsetWithinBlock(
    block: InputHarnessBlockDescriptor,
    requestedSourceOffset: number
): InputHarnessLogicalPosition {
    // Source offsets remain the recovery primitive, so unsupported interior locations snap to the nearest valid text or atom boundary.
    const firstPart = block.parts[0];
    if (requestedSourceOffset <= firstPart.sourceRange.start) {
        return resolveBoundaryBeforePart(block, firstPart);
    }

    for (let index = 0; index < block.parts.length; index += 1) {
        const part = block.parts[index];
        if (part.kind === "text") {
            if (requestedSourceOffset <= part.sourceRange.end) {
                return {
                    kind: "text",
                    blockKey: block.key,
                    sourceOffset: requestedSourceOffset,
                    textOffset: part.textStart + (requestedSourceOffset - part.sourceRange.start),
                };
            }
        } else if (requestedSourceOffset <= part.sourceRange.end) {
            const midpoint = part.sourceRange.start + Math.floor((part.sourceRange.end - part.sourceRange.start) / 2);
            return {
                kind: "atom",
                blockKey: block.key,
                atomKey: part.key,
                side: requestedSourceOffset <= midpoint ? "before" : "after",
                sourceOffset: requestedSourceOffset <= midpoint ? part.sourceRange.start : part.sourceRange.end,
            };
        }

        const nextPart = block.parts[index + 1];
        if (nextPart && requestedSourceOffset < nextPart.sourceRange.start) {
            const leftPosition = resolveBoundaryAfterPart(block, part);
            const rightPosition = resolveBoundaryBeforePart(block, nextPart);

            return requestedSourceOffset - part.sourceRange.end <= nextPart.sourceRange.start - requestedSourceOffset
                ? leftPosition
                : rightPosition;
        }
    }

    return resolveBoundaryAfterPart(block, block.parts[block.parts.length - 1]);
}

function resolveBoundaryBeforePart(block: InputHarnessBlockDescriptor, part: InputHarnessInlinePart): InputHarnessLogicalPosition {
    if (part.kind === "atom") {
        return {
            kind: "atom",
            blockKey: block.key,
            atomKey: part.key,
            side: "before",
            sourceOffset: part.sourceRange.start,
        };
    }

    return {
        kind: "text",
        blockKey: block.key,
        sourceOffset: part.sourceRange.start,
        textOffset: part.textStart,
    };
}

function resolveBoundaryAfterPart(block: InputHarnessBlockDescriptor, part: InputHarnessInlinePart): InputHarnessLogicalPosition {
    if (part.kind === "atom") {
        return {
            kind: "atom",
            blockKey: block.key,
            atomKey: part.key,
            side: "after",
            sourceOffset: part.sourceRange.end,
        };
    }

    return {
        kind: "text",
        blockKey: block.key,
        sourceOffset: part.sourceRange.end,
        textOffset: part.textEnd,
    };
}

function getTextPartForTextOffset(block: InputHarnessBlockDescriptor, textOffset: number): InputHarnessTextPart {
    const textParts = block.parts.filter((part): part is InputHarnessTextPart => part.kind === "text");
    if (textParts.length === 0) {
        throw new Error(`Block ${block.key} does not expose a text editing surface.`);
    }

    for (const textPart of textParts) {
        if (textOffset <= textPart.textEnd) {
            return textPart;
        }
    }

    return textParts[textParts.length - 1];
}

function getBlockByKey(document: InputHarnessDocument, blockKey: string): InputHarnessBlockDescriptor {
    const block = document.blocks.find((candidate) => candidate.key === blockKey);
    if (!block) {
        throw new Error(`Unknown input harness block ${blockKey}.`);
    }

    return block;
}

function getPartByKey(block: InputHarnessBlockDescriptor, partKey: string): InputHarnessInlinePart {
    const part = block.parts.find((candidate) => candidate.key === partKey);
    if (!part) {
        throw new Error(`Unknown input harness part ${partKey} in block ${block.key}.`);
    }

    return part;
}

function getAtomByKey(document: InputHarnessDocument, atomKey: string): InputHarnessAtomPart & { blockKey: string } {
    for (const block of document.blocks) {
        for (const part of block.parts) {
            if (part.kind === "atom" && part.key === atomKey) {
                return {
                    ...part,
                    blockKey: block.key,
                };
            }
        }
    }

    throw new Error(`Unknown input harness atom ${atomKey}.`);
}

function applyDeletionIntent(
    document: InputHarnessDocument,
    selection: InputHarnessSelection,
    direction: InputHarnessDeleteDirection
): InputHarnessBeforeInputOutcome {
    if (selection.kind === "node" || !isCollapsedSelection(selection)) {
        return {
            kind: "mutation",
            mutation: replaceInputHarnessSelection(document, selection, ""),
        };
    }

    const caret = selection.focus;
    const block = getBlockByKey(document, caret.blockKey);
    const partIndex = findCaretPartIndex(block, caret);

    if (caret.kind === "atom") {
        if (direction === "backward" && caret.side === "after") {
            return {
                kind: "selection",
                selection: createInputHarnessNodeSelection(document, caret.atomKey),
            };
        }

        if (direction === "forward" && caret.side === "before") {
            return {
                kind: "selection",
                selection: createInputHarnessNodeSelection(document, caret.atomKey),
            };
        }

        const adjacentPart = direction === "backward" ? block.parts[partIndex - 1] : block.parts[partIndex + 1];
        return applyAdjacentPartDeletion(document, adjacentPart, direction);
    }

    const currentPart = block.parts[partIndex];
    if (currentPart?.kind !== "text") {
        return {
            kind: "unsupported",
            reason: "The caret could not be mapped to a text editing surface.",
        };
    }

    if (direction === "backward") {
        if (caret.sourceOffset > currentPart.sourceRange.start) {
            return createDeletionMutationOutcome(document, caret.sourceOffset - 1, caret.sourceOffset);
        }

        const previousPart = block.parts[partIndex - 1];
        if (previousPart?.kind === "atom") {
            return {
                kind: "selection",
                selection: createInputHarnessNodeSelection(document, previousPart.key),
            };
        }

        return applyAdjacentPartDeletion(document, previousPart, direction);
    }

    if (caret.sourceOffset < currentPart.sourceRange.end) {
        return createDeletionMutationOutcome(document, caret.sourceOffset, caret.sourceOffset + 1);
    }

    const nextPart = block.parts[partIndex + 1];
    if (nextPart?.kind === "atom") {
        return {
            kind: "selection",
            selection: createInputHarnessNodeSelection(document, nextPart.key),
        };
    }

    return applyAdjacentPartDeletion(document, nextPart, direction);
}

function applyAdjacentPartDeletion(
    document: InputHarnessDocument,
    adjacentPart: InputHarnessInlinePart | undefined,
    direction: InputHarnessDeleteDirection
): InputHarnessBeforeInputOutcome {
    if (!adjacentPart) {
        return {
            kind: "unsupported",
            reason: `Phase 0 does not yet handle structural deletion at the ${direction === "backward" ? "start" : "end"} of a block.`,
        };
    }

    if (adjacentPart.kind === "atom") {
        return {
            kind: "selection",
            selection: createInputHarnessNodeSelection(document, adjacentPart.key),
        };
    }

    if (adjacentPart.sourceRange.start === adjacentPart.sourceRange.end) {
        return {
            kind: "unsupported",
            reason: "Phase 0 cannot delete across an empty structural boundary yet.",
        };
    }

    return direction === "backward"
        ? createDeletionMutationOutcome(document, adjacentPart.sourceRange.end - 1, adjacentPart.sourceRange.end)
        : createDeletionMutationOutcome(document, adjacentPart.sourceRange.start, adjacentPart.sourceRange.start + 1);
}

function createDeletionMutationOutcome(
    document: InputHarnessDocument,
    start: number,
    end: number
): InputHarnessBeforeInputOutcome {
    return {
        kind: "mutation",
        mutation: replaceInputHarnessSelection(document, createSourceRangeSelection(document, start, end), ""),
    };
}

function createSourceRangeSelection(document: InputHarnessDocument, start: number, end: number): InputHarnessSelection {
    return createSelection(
        resolveSourceOffsetToLogicalPosition(document, start),
        resolveSourceOffsetToLogicalPosition(document, end)
    );
}

function findCaretPartIndex(block: InputHarnessBlockDescriptor, position: InputHarnessLogicalPosition): number {
    if (position.kind === "atom") {
        return block.parts.findIndex((part) => part.kind === "atom" && part.key === position.atomKey);
    }

    return block.parts.findIndex(
        (part) => part.kind === "text" && position.sourceOffset >= part.sourceRange.start && position.sourceOffset <= part.sourceRange.end
    );
}

function isCollapsedSelection(selection: InputHarnessSelection): boolean {
    return compareLogicalPositions(selection.anchor, selection.focus) === 0;
}

function createSelection(
    anchor: InputHarnessLogicalPosition,
    focus: InputHarnessLogicalPosition,
    selectedAtomKey?: string
): InputHarnessSelection {
    const direction = compareLogicalPositions(anchor, focus) <= 0 ? "forward" : "backward";

    return {
        kind: selectedAtomKey ? "node" : "text",
        anchor,
        focus,
        direction,
        selectedAtomKey,
    };
}

function compareLogicalPositions(left: InputHarnessLogicalPosition, right: InputHarnessLogicalPosition): number {
    if (left.sourceOffset !== right.sourceOffset) {
        return left.sourceOffset - right.sourceOffset;
    }

    const leftRank = left.kind === "atom" && left.side === "after" ? 1 : 0;
    const rightRank = right.kind === "atom" && right.side === "after" ? 1 : 0;

    return leftRank - rightRank;
}

function toOrderedSourceRange(selection: InputHarnessSelection): SourceRange {
    return compareLogicalPositions(selection.anchor, selection.focus) <= 0
        ? { start: selection.anchor.sourceOffset, end: selection.focus.sourceOffset }
        : { start: selection.focus.sourceOffset, end: selection.anchor.sourceOffset };
}

function splitLinesWithOffsets(source: string, baseOffset: number): RawLine[] {
    if (source.length === 0) {
        return [];
    }

    const lines: RawLine[] = [];
    let lineStart = 0;

    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (character !== "\n") {
            continue;
        }

        const raw = source.slice(lineStart, index + 1);
        lines.push(createRawLine(raw, baseOffset + lineStart));
        lineStart = index + 1;
    }

    if (lineStart < source.length) {
        lines.push(createRawLine(source.slice(lineStart), baseOffset + lineStart));
    }

    return lines;
}

function createRawLine(raw: string, start: number): RawLine {
    const lineEnding = raw.endsWith("\r\n") ? "\r\n" : raw.endsWith("\n") ? "\n" : "";
    const text = lineEnding.length > 0 ? raw.slice(0, -lineEnding.length) : raw;

    return {
        raw,
        text,
        lineEnding,
        start,
        end: start + raw.length,
    };
}

function trimTrailingLineEnding(value: string): string {
    return value.endsWith("\r\n") ? value.slice(0, -2) : value.endsWith("\n") ? value.slice(0, -1) : value;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}
