/**
 * Serialize a document tree to its source text representation.
 * Structurally typed — works with any object that has prefix, children (with leadingTrivia + raw), and suffix.
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
