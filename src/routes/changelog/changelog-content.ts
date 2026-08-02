// The `/changelog` seed: the repo's own changelog, byte-for-byte, behind an outline the route
// contributes. The outline sits inside a collapsed `<details>` so a reader lands on the newest
// entry rather than on a version index — in reading mode expanding it writes no bytes.
import changelogSource from '../../../docs/changelog.md?raw';

export const CHANGELOG_DOCUMENT = `<details>\n<summary>Versions</summary>\n\n[[toc]]\n\n</details>\n\n${changelogSource}`;
