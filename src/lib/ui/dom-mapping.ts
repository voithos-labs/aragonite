/**
 * Browser DOM mapping helpers for the narrow editor harness.
 */
import {
    mapInputHarnessLogicalSelectionToDomSelection,
    type InputHarnessDocument,
    type InputHarnessDomPoint,
    type InputHarnessDomSelection,
    type InputHarnessSelection,
    type ViewProjectionBlockDescriptor,
    type ViewProjectionDocument,
} from "$lib/editor";
import { mapBrowserBoundaryToInputHarnessDomPoint } from "./dom-boundaries.js";

interface BrowserDomBoundary {
    node: Node;
    offset: number;
}

/**
 * Reads the current browser selection and maps it onto the headless DOM point contract.
 */
export function readInputHarnessDomSelectionFromBrowser(
    rootElement: HTMLElement,
    projection: ViewProjectionDocument
): InputHarnessDomSelection | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        return null;
    }

    const anchor = mapBrowserBoundaryToInputHarnessDomPoint(rootElement, projection, selection.anchorNode, selection.anchorOffset);
    const focus = mapBrowserBoundaryToInputHarnessDomPoint(rootElement, projection, selection.focusNode, selection.focusOffset);

    if (!anchor || !focus) {
        return null;
    }

    return { anchor, focus };
}

/**
 * Applies a logical selection to the browser DOM by locating the projection runs that own each endpoint.
 */
export function applyInputHarnessSelectionToBrowser(
    rootElement: HTMLElement,
    projection: ViewProjectionDocument,
    inputDocument: InputHarnessDocument,
    selection: InputHarnessSelection
): boolean {
    const domSelection = mapInputHarnessLogicalSelectionToDomSelection(inputDocument, selection);
    const anchor = mapDomPointToBrowserBoundary(rootElement, projection, domSelection.anchor);
    const focus = mapDomPointToBrowserBoundary(rootElement, projection, domSelection.focus);

    if (!anchor || !focus) {
        return false;
    }

    const browserSelection = window.getSelection();
    if (!browserSelection) {
        return false;
    }

    const range = globalThis.document.createRange();
    range.setStart(anchor.node, anchor.offset);
    range.setEnd(focus.node, focus.offset);
    browserSelection.removeAllRanges();
    browserSelection.addRange(range);

    return true;
}

/**
 * Formats a logical selection for on-screen debugging during the harness phase.
 */
export function describeInputHarnessSelection(selection: InputHarnessSelection | null): string {
    if (!selection) {
        return "No logical selection";
    }

    if (selection.kind === "node") {
        return `Node selection: ${selection.selectedAtomKey ?? "unknown atom"}`;
    }

    return `Text selection: ${selection.anchor.blockKey} @ ${selection.anchor.sourceOffset} -> ${selection.focus.sourceOffset}`;
}

function mapDomPointToBrowserBoundary(
    rootElement: HTMLElement,
    projection: ViewProjectionDocument,
    domPoint: InputHarnessDomPoint
): BrowserDomBoundary | null {
    const block = findBlockByKey(projection, domPoint.blockKey);
    const partRuns = block.runs.filter((run) => run.partKey === domPoint.partKey);
    if (partRuns.length === 0) {
        return null;
    }

    if (domPoint.kind === "atom") {
        const atomRun = partRuns.find((run) => run.atomic);
        if (!atomRun) {
            return null;
        }

        const atomElement = rootElement.querySelector<HTMLElement>(`[data-editor-run-key="${atomRun.key}"]`);
        if (!atomElement || !atomElement.parentNode) {
            return null;
        }

        const parent = atomElement.parentNode;
        const siblingIndex = Array.from(parent.childNodes).indexOf(atomElement);
        return {
            node: parent,
            offset: domPoint.side === "after" ? siblingIndex + 1 : siblingIndex,
        };
    }

    let remainingOffset = domPoint.offset;
    for (const run of partRuns) {
        const runLength = run.text.length;
        if (remainingOffset <= runLength) {
            const runElement = rootElement.querySelector<HTMLElement>(`[data-editor-run-key="${run.key}"]`);
            if (!runElement) {
                return null;
            }

            const textNode = runElement.firstChild;
            if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                return {
                    node: textNode,
                    offset: clamp(remainingOffset, 0, runLength),
                };
            }

            return {
                node: runElement,
                offset: 0,
            };
        }

        remainingOffset -= runLength;
    }

    const lastRun = partRuns[partRuns.length - 1];
    const lastElement = rootElement.querySelector<HTMLElement>(`[data-editor-run-key="${lastRun.key}"]`);
    if (!lastElement) {
        return null;
    }

    const textNode = lastElement.firstChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        return {
            node: textNode,
            offset: lastRun.text.length,
        };
    }

    return {
        node: lastElement,
        offset: 0,
    };
}

function findBlockByKey(projection: ViewProjectionDocument, blockKey: string): ViewProjectionBlockDescriptor {
    const block = projection.blocks.find((candidate) => candidate.blockKey === blockKey);
    if (!block) {
        throw new Error(`Unknown projection block ${blockKey}.`);
    }

    return block;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}
