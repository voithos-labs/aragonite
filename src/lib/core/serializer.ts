/**
 * Serialize a document tree to its source text representation.
 * Works with both immutable Document and MutableDocument via structural typing.
 */

/** Structural type accepted by serialize. */
interface Serializable {
    prefix: string;
    children: { leadingTrivia: string; raw: string }[];
    suffix: string;
}

export function serialize(document: Serializable): string {
    return (
        document.prefix +
        document.children.map((node) => node.leadingTrivia + node.raw).join('') +
        document.suffix
    );
}
