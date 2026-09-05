// The `/changelog` seed: the repo's own changelog, byte-for-byte, one release family at a time,
// behind an outline the route contributes. The outline sits inside a collapsed `<details>` so a
// reader lands on the newest entry rather than on a version index — in reading mode expanding it
// writes no bytes.
const familySources = import.meta.glob('../../../docs/changelog/*.md', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

export interface ChangelogFamily {
	/** The minor family the file covers, e.g. `0.9`. */
	id: string;
	document: string;
}

const familyOrder = (id: string): number => {
	const [major, minor] = id.split('.').map(Number);
	return major * 1000 + minor;
};

export const CHANGELOG_FAMILIES: ChangelogFamily[] = Object.entries(familySources)
	.map(([path, source]) => ({
		id: path.slice(path.lastIndexOf('/') + 1, -'.md'.length),
		document: `<details>\n<summary>Versions</summary>\n\n[[toc]]\n\n</details>\n\n${source}`
	}))
	.sort((a, b) => familyOrder(b.id) - familyOrder(a.id));
