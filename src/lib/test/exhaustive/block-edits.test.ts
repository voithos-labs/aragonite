// @vitest-environment jsdom
// Every block edit at every offset of every short string over the Markdown alphabet: a typed
// character, a delete either side of the caret (a merge at the leaf's edge), and a split. Each
// must change the bytes, leave the tree a reload of them would build, fire no dev check, and undo
// to the original bytes and redo to the edit.
import { it } from 'vitest';
import { trimTrailingLineEnding } from '#lib/core/lines.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { enumerateStrings } from '../gfm-conformance/corpus';
import { ALPHABET_PLUGINS, EDIT_LENGTH, EXHAUSTIVE_ALPHABET } from './alphabet';
import { EDITS, judge, leafAt, leafPaths, opened } from './edit-driver';
import { holdToKnownFailures } from './known-failures';

it(`keeps every block edit at every offset up to length ${EDIT_LENGTH} reading back as a reload`, async () => {
	installPlugins(ALPHABET_PLUGINS());
	const failures: string[] = [];
	for (const source of enumerateStrings(EXHAUSTIVE_ALPHABET, 1, EDIT_LENGTH)) {
		const blocks = opened(source).children;
		for (const path of leafPaths(blocks)) {
			const end = trimTrailingLineEnding(leafAt(blocks, path).raw).length;
			for (let offset = 0; offset <= end; offset++) {
				for (const edit of EDITS) {
					const failure = await judge(source, path, offset, edit);
					if (failure)
						failures.push(`${JSON.stringify(source)} [${path}]@${offset} ${edit.name}: ${failure}`);
				}
			}
		}
	}
	holdToKnownFailures('edits', failures, EDIT_LENGTH);
}, 3_600_000);
