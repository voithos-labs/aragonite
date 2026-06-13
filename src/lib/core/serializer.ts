// Structurally typed: accepts any object with prefix/children/suffix so nested
// containers (blockquote, list, listItem) can serialize without a class.

interface Serializable {
	prefix: string;
	children: { leadingTrivia: string; raw: string }[];
	suffix: string;
}

/** The one child-join: container rebuilders and serialize() share it. */
export function concatChildren(children: { leadingTrivia: string; raw: string }[]): string {
	let out = '';
	for (const c of children) out += c.leadingTrivia + c.raw;
	return out;
}

export function serialize(document: Serializable): string {
	return document.prefix + concatChildren(document.children) + document.suffix;
}
