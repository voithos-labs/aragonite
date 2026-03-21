import type { Document } from './nodes';

export function serialize(document: Document): string {
    return (
        document.prefix +
        document.children.map((node) => node.leadingTrivia + node.raw).join('') +
        document.suffix
    );
}
