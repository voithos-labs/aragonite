/**
 * Mutable document tree for the editor.
 * Converts immutable parsed CST into a writable working copy.
 */

import type { CstNode, Document } from './core/nodes';
import type { ContainerBlock } from './core/nodes';
import type { MutableNode, MutableDocument } from './editor-types';

// ── Conversion ──────────────────────────────────────────────────────────────

export function toMutable(doc: Document): MutableDocument {
    return {
        kind: 'document',
        prefix: doc.prefix,
        children: doc.children.map(nodeToMutable),
        suffix: doc.suffix
    };
}

function nodeToMutable(node: CstNode): MutableNode {
    const mutable: MutableNode = {
        kind: node.kind,
        leadingTrivia: node.leadingTrivia,
        raw: node.raw
    };

    if ('metadata' in node && node.metadata) {
        mutable.metadata = { ...(node.metadata as Record<string, unknown>) };
    }

    if ('innerPrefix' in node) {
        const container = node as ContainerBlock;
        mutable.innerPrefix = container.innerPrefix;
        mutable.children = container.children.map(nodeToMutable);
        mutable.innerSuffix = container.innerSuffix;
    }

    return mutable;
}

// ── Serialization ───────────────────────────────────────────────────────────

export function serializeMutable(doc: MutableDocument): string {
    return (
        doc.prefix +
        doc.children.map((node) => node.leadingTrivia + node.raw).join('') +
        doc.suffix
    );
}

// ── Cloning ─────────────────────────────────────────────────────────────────

export function cloneDocument(doc: MutableDocument): MutableDocument {
    return {
        kind: 'document',
        prefix: doc.prefix,
        children: doc.children.map(cloneNode),
        suffix: doc.suffix
    };
}

function cloneNode(node: MutableNode): MutableNode {
    const cloned: MutableNode = {
        kind: node.kind,
        leadingTrivia: node.leadingTrivia,
        raw: node.raw
    };

    if (node.metadata) {
        cloned.metadata = { ...node.metadata };
    }

    if (node.children) {
        cloned.innerPrefix = node.innerPrefix;
        cloned.children = node.children.map(cloneNode);
        cloned.innerSuffix = node.innerSuffix;
    }

    return cloned;
}

// ── Block IDs ───────────────────────────────────────────────────────────────

export function generateBlockId(): string {
    return crypto.randomUUID();
}

export function assignIds(children: MutableNode[]): string[] {
    return children.map(() => generateBlockId());
}
