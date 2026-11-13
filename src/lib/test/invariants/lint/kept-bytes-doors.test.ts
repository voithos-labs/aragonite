/**
 * G4.353: bytes read off the record the editor keeps across writes leave it through a vouch, so
 * every file that reads the document's text for a write, or hands the range-edit core the
 * editor's own document, is declared with the vouch its bytes pass. A new reader fails here until
 * it names one: a wrong record would otherwise reach the tree or the clipboard unseen.
 */

import { describe, expect, it } from 'vitest';
import { collectEditorSources } from './scan-source';
import { describeManifests } from './file-rule';
import { SOURCE } from './source-paths';

/** Each reader of the text a write is worked out from, and where its bytes are vouched. */
const TEXT_READERS: Record<string, string> = {
	'src/lib/selection/range-bytes.ts':
		'`rangeRead`, the one read a range gesture starts from, vouches the range’s blocks',
	'src/lib/selection/cross-block/range-removal.ts':
		'the changes it makes from that read land through the byte splice',
	'src/lib/editor-actions/commit/byte-splice.ts':
		'the byte splice vouches the blocks its reading took before it installs them',
	'src/lib/editor-actions/commit/history.ts':
		'an undo read again under another grammar vouches its reading, and reads once more',
	'src/lib/components/Editor.svelte':
		'the wiring: a draft and the test door’s splice both land through the byte splice'
};

/** Each file that hands the range-edit core the editor's own document. */
const CORE_HOSTS: Record<string, string> = {
	'src/lib/range-edit/host.ts': 'the declaration',
	'src/lib/selection/cross-block/range-removal.ts': 'over a `rangeRead`',
	'src/lib/selection/range-clipboard.ts': 'over a `rangeRead`'
};

const sources = collectEditorSources();

describeManifests(
	[
		{
			id: 'exactly the declared files read the text a write is worked out from',
			matches: /\bbytes\.source\b/,
			declared: TEXT_READERS,
			reason:
				'a new reader of the document’s bytes: name the vouch its bytes pass before they reach the tree or the clipboard (`KeptStarts.vouch`, `rangeRead`)',
			hits: ['const source = ctx.bytes.source();', 'source: bytes.source,'],
			misses: ['const source = read.source;', '// bytes.source() is the text door']
		},
		{
			id: 'exactly the declared files hand the range-edit core the editor’s own document',
			matches: /\brangeHost\s*\(/,
			declared: CORE_HOSTS,
			reason:
				'a new range gesture: take its range and its document from `rangeRead`, which vouches the range’s blocks',
			hits: ['rangeHost(ctx.reading, read)'],
			misses: ['const host: RangeHost = hostOf(read);']
		}
	],
	sources
);

// The saved text is read off the tree and never off the record, so it has the two readers a host
// reaches, and nothing that works out a write may take it in place of the record's text.
describe('exactly `getSource()` and the swap check read the saved text', () => {
	it('each of the editor’s two reads is made once', () => {
		const editor = sources.find((file) => file.relPath === SOURCE.editorShell);
		const reads = [...(editor?.code ?? '').matchAll(/\bcurrentSource\.(read\w*)\b/g)].map(
			(m) => m[1]
		);
		expect(reads.sort()).toEqual(['read', 'readUnchecked']);
	});
});
