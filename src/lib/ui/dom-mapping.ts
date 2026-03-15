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
    type ViewProjectionInlineRun,
} from "$lib/editor";

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

    const anchor = mapBrowserBoundaryToDomPoint(rootElement, projection, selection.anchorNode, selection.anchorOffset);
    const focus = mapBrowserBoundaryToDomPoint(rootElement, projection, selection.focusNode, selection.focusOffset);

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

function mapBrowserBoundaryToDomPoint(
    rootElement: HTMLElement,
    projection: ViewProjectionDocument,
    node: Node | null,
    offset: number
): InputHarnessDomPoint | null {
    if (!node) {
        return null;
    }

    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node instanceof HTMLElement ? node : null;
    if (!element) {
        return null;
    }

    const runElement = element.closest<HTMLElement>("[data-editor-run-key]");
    const blockElement = element.closest<HTMLElement>("[data-editor-block-key]");
    if (!runElement || !blockElement || !rootElement.contains(runElement)) {
        return null;
    }

    const blockKey = blockElement.dataset.editorBlockKey;
    const runKey = runElement.dataset.editorRunKey;
    const partKey = runElement.dataset.editorPartKey;
    const runKind = runElement.dataset.editorRunKind;
    if (!blockKey || !runKey || !partKey || !runKind) {
        return null;
    }

    if (runKind === "atom") {
        const side = offset <= 0 ? "before" : "after";
        return {
            blockKey,
            partKey,
            kind: "atom",
            offset: 0,
            side,
        };
    }

    const run = findRunByKey(projection, blockKey, runKey);
    const localOffset = clamp(resolveTextOffsetWithinRun(node, runElement, offset, run.text.length), 0, run.text.length);

    return {
        blockKey,
        partKey,
        kind: "text",
        offset: countPartOffsetBeforeRun(projection, blockKey, run) + localOffset,
    };
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

function findRunByKey(
    projection: ViewProjectionDocument,
    blockKey: string,
    runKey: string
): ViewProjectionInlineRun {
    const block = findBlockByKey(projection, blockKey);
    const run = block.runs.find((candidate) => candidate.key === runKey);
    if (!run) {
        throw new Error(`Unknown projection run ${runKey}.`);
    }

    return run;
}

function countPartOffsetBeforeRun(
    projection: ViewProjectionDocument,
    blockKey: string,
    run: ViewProjectionInlineRun
): number {
    const block = findBlockByKey(projection, blockKey);
    let total = 0;

    for (const candidate of block.runs) {
        if (candidate.partKey !== run.partKey) {
            continue;
        }

        if (candidate.key === run.key) {
            return total;
        }

        total += candidate.text.length;
    }

    return total;
}

function resolveTextOffsetWithinRun(node: Node, runElement: HTMLElement, offset: number, maximum: number): number {
    if (node.nodeType === Node.TEXT_NODE) {
        return offset;
    }

    if (node === runElement) {
        return offset <= 0 ? 0 : maximum;
    }

    return offset;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}
