// Structurally typed so nested containers and readonly node views serialize without a class.

interface Serializable {
	readonly prefix: string;
	readonly children: readonly { readonly leadingTrivia: string; readonly raw: string }[];
	readonly suffix: string;
}

/** The one child-join: container rebuilders and serialize() share it. */
export function concatChildren(
	children: readonly { readonly leadingTrivia: string; readonly raw: string }[]
): string {
	let out = '';
	for (const c of children) out += c.leadingTrivia + c.raw;
	return out;
}

export function serialize(document: Serializable): string {
	return document.prefix + concatChildren(document.children) + document.suffix;
}
