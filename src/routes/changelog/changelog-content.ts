// The document `/changelog` loads: the repo's own changelog, one release family at a time, behind
// an outline this route adds. The outline sits inside a collapsed `<details>` so the user lands on
// the newest entry rather than on a version index; in reading mode expanding it writes no bytes.
const familySources = import.meta.glob('../../../docs/changelog/*.md', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

// A family file opens with a link to `../changelog.md`, right on GitHub and a 404 beside this
// page, so that one line goes before the file mounts.
const INDEX_POINTER = /^Newest first; the index is \[[^\]]*\]\(\.\.\/changelog\.md\)\.\n\n/m;

const OUTLINE = '<details>\n<summary>Versions</summary>\n\n[[toc]]\n\n</details>\n\n';

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
		document: OUTLINE + source.replace(INDEX_POINTER, '')
	}))
	.sort((a, b) => familyOrder(b.id) - familyOrder(a.id));
