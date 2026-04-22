// Structurally typed: accepts any object with prefix/children/suffix so nested
// containers (blockquote, list, listItem) can serialize without a class.

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
