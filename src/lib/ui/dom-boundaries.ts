/**
 * Browser boundary mapping helpers for the narrow editor harness.
 */
import {
    type InputHarnessAtomSide,
    type InputHarnessDomPoint,
    type ViewProjectionBlockDescriptor,
    type ViewProjectionDocument,
    type ViewProjectionInlineRun,
} from "$lib/editor";

export function mapBrowserBoundaryToInputHarnessDomPoint(
    rootElement: HTMLElement,
    projection: ViewProjectionDocument,
    node: Node | null,
    offset: number
): InputHarnessDomPoint | null {
    if (!node) {
        return null;
    }

    if (node === rootElement) {
        return mapRootBoundaryToDomPoint(rootElement, projection, offset);
    }

    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node instanceof HTMLElement ? node : null;
    if (!element) {
        return null;
    }

    const runElement = element.closest<HTMLElement>("[data-editor-run-key]");
    const blockElement = element.closest<HTMLElement>("[data-editor-block-key]");
    if (runElement && blockElement && rootElement.contains(runElement)) {
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

    if (!blockElement || !rootElement.contains(blockElement)) {
        return null;
    }

    const boundaryIndex = resolveContainerBoundaryIndex(blockElement, node, offset);
    if (boundaryIndex === null) {
        return null;
    }

    return mapBlockBoundaryToDomPoint(projection, blockElement, boundaryIndex);
}

function mapRootBoundaryToDomPoint(
    rootElement: HTMLElement,
    projection: ViewProjectionDocument,
    boundaryIndex: number
): InputHarnessDomPoint | null {
    const childNodes = Array.from(rootElement.childNodes);
    const previousBlock = findSiblingBlockElement(childNodes, boundaryIndex - 1, -1);
    if (previousBlock) {
        return mapBlockBoundaryToDomPoint(projection, previousBlock, previousBlock.childNodes.length);
    }

    const nextBlock = findSiblingBlockElement(childNodes, boundaryIndex, 1);
    if (nextBlock) {
        return mapBlockBoundaryToDomPoint(projection, nextBlock, 0);
    }

    return null;
}

function mapBlockBoundaryToDomPoint(
    projection: ViewProjectionDocument,
    blockElement: HTMLElement,
    boundaryIndex: number
): InputHarnessDomPoint | null {
    const blockKey = blockElement.dataset.editorBlockKey;
    if (!blockKey) {
        return null;
    }

    const childNodes = Array.from(blockElement.childNodes);
    const previousRun = findSiblingRunElement(childNodes, boundaryIndex - 1, -1);
    if (previousRun) {
        return createBoundaryDomPointFromRun(projection, blockKey, previousRun, "after");
    }

    const nextRun = findSiblingRunElement(childNodes, boundaryIndex, 1);
    if (nextRun) {
        return createBoundaryDomPointFromRun(projection, blockKey, nextRun, "before");
    }

    return null;
}

function createBoundaryDomPointFromRun(
    projection: ViewProjectionDocument,
    blockKey: string,
    runElement: HTMLElement,
    side: InputHarnessAtomSide
): InputHarnessDomPoint | null {
    const runKey = runElement.dataset.editorRunKey;
    const partKey = runElement.dataset.editorPartKey;
    const runKind = runElement.dataset.editorRunKind;
    if (!runKey || !partKey || !runKind) {
        return null;
    }

    if (runKind === "atom") {
        return {
            blockKey,
            partKey,
            kind: "atom",
            offset: 0,
            side,
        };
    }

    const run = findRunByKey(projection, blockKey, runKey);
    const runStart = countPartOffsetBeforeRun(projection, blockKey, run);
    return {
        blockKey,
        partKey,
        kind: "text",
        offset: side === "before" ? runStart : runStart + run.text.length,
    };
}

function resolveContainerBoundaryIndex(container: Node, node: Node, offset: number): number | null {
    if (node === container) {
        return clamp(offset, 0, container.childNodes.length);
    }

    const child = findDirectChildWithinContainer(container, node);
    if (!child) {
        return null;
    }

    const childNodes = Array.from(container.childNodes);
    const childIndex = childNodes.findIndex((candidate) => candidate === child);
    if (childIndex < 0) {
        return null;
    }

    return offset <= 0 ? childIndex : childIndex + 1;
}

function findDirectChildWithinContainer(container: Node, node: Node): Node | null {
    let current: Node | null = node;

    while (current && current.parentNode !== container) {
        current = current.parentNode;
    }

    return current?.parentNode === container ? current : null;
}

function findSiblingRunElement(childNodes: Node[], startIndex: number, step: 1 | -1): HTMLElement | null {
    for (let index = startIndex; index >= 0 && index < childNodes.length; index += step) {
        const child = childNodes[index];
        if (child instanceof HTMLElement && child.dataset.editorRunKey) {
            return child;
        }
    }

    return null;
}

function findSiblingBlockElement(childNodes: Node[], startIndex: number, step: 1 | -1): HTMLElement | null {
    for (let index = startIndex; index >= 0 && index < childNodes.length; index += step) {
        const child = childNodes[index];
        if (child instanceof HTMLElement && child.dataset.editorBlockKey) {
            return child;
        }
    }

    return null;
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
