/** Structural type accepted by serialize — works with both immutable Document and MutableDocument. */
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
