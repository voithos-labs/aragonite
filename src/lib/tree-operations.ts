/**
 * Pure tree mutation functions for the editor.
 * All functions operate on MutableDocument in place.
 */

import type { MutableDocument, MutableNode } from './editor-types';
import { parse } from './core/parser';
import { generateBlockId } from './mutable-tree';

// ── Split ───────────────────────────────────────────────────────────────────

/**
 * Split the node at `blockIndex` into two nodes at the given raw `offset`.
 * The first node keeps the original ID. A new ID is inserted for the second node.
 * Both halves are re-parsed to determine their block type.
 *
 * The offset is relative to the displayed text content (without trailing line ending).
 * The line ending style (\n or \r\n) is preserved from the original raw.
 */
export function splitNode(
    doc: MutableDocument,
    blockIds: string[],
    blockIndex: number,
    offset: number
): void {
    const node = doc.children[blockIndex];
    const rawText = node.raw;

    // Detect line ending style from the original raw
    const lineEnding = rawText.endsWith('\r\n') ? '\r\n' : '\n';

    // Split the raw text at the offset
    let firstRaw = rawText.slice(0, offset);
    let secondRaw = rawText.slice(offset);

    // Ensure the first part ends with a line ending
    if (!firstRaw.endsWith('\n')) {
        firstRaw += lineEnding;
    }

    // Ensure the second part ends with a line ending
    if (secondRaw.length === 0 || !secondRaw.endsWith('\n')) {
        if (secondRaw.length === 0) {
            secondRaw = lineEnding;
        } else {
            secondRaw += lineEnding;
        }
    }

    // Re-parse each half to determine block type
    const firstNode = reparseAsNode(firstRaw, node.leadingTrivia);
    // No blank line between split halves — empty leading trivia
    const secondNode = reparseAsNode(secondRaw, '');

    // Replace the original node with the two new nodes
    doc.children.splice(blockIndex, 1, firstNode, secondNode);

    // Update IDs: original stays, new one inserted after
    blockIds.splice(blockIndex + 1, 0, generateBlockId());
}

/**
 * Parse a raw string as a single block node.
 * Returns a MutableNode with the parsed kind and metadata.
 */
function reparseAsNode(raw: string, leadingTrivia: string): MutableNode {
    const parsed = parse(raw);
    if (parsed.children.length > 0) {
        const child = parsed.children[0];
        const node: MutableNode = {
            kind: child.kind,
            leadingTrivia,
            raw
        };
        if ('metadata' in child && child.metadata) {
            node.metadata = { ...(child.metadata as Record<string, unknown>) };
        }
        return node;
    }

    // Fallback: empty parse result
    return {
        kind: 'paragraph',
        leadingTrivia,
        raw
    };
}
