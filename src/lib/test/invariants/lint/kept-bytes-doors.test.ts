/**
 * G4.353: bytes read off the record the editor keeps across writes leave it through a vouch, so
 * every file that reads the document's text for a write, hands the range-edit core the editor's
 * own document, or takes a position off the kept starts is declared with the vouch its bytes
 * pass. A new reader fails here until it names one: a wrong record would otherwise reach the tree
 * or the clipboard unseen.
 */

import { describe, expect, it } from 'vitest';
import { collectEditorSources } from './scan-source';
import { describeManifests } from './file-rule';
import { SOURCE } from './source-paths';

/** Each reader of the text a write is worked out from, and where its bytes are vouched. */
const TEXT_READERS: Record<string, string> = {
	'src/lib/selection/range-bytes.ts':
		'`rangeRead`, the one read a range gesture starts from, vouches the blocks it names and reaches',
	'src/lib/selection/cross-block/range-removal.ts':
		'the changes it makes from that read land through the byte splice',
	'src/lib/editor-actions/commit/byte-splice.ts':
		'the byte splice vouches the blocks its reading took before it installs them',
	'src/lib/editor-actions/commit/history.ts':
		'an undo read again under another grammar vouches its reading, and reads once more',
	'src/lib/components/Editor.svelte':
		'the wiring: a draft vouches the blocks it names, and it and the test door land through the byte splice'
};

/** Each file that hands the range-edit core the editor's own document. */
const CORE_HOSTS: Record<string, string> = {
	'src/lib/range-edit/host.ts': 'the declaration',
	'src/lib/selection/cross-block/range-removal.ts': 'over a `rangeRead`',
	'src/lib/selection/range-clipboard.ts': 'over a `rangeRead`'
};

/** Each file that takes a position off the kept starts, and what holds the bytes made from one:
 *  a byte counted from a path's offset is right only where the record holds that path's block. */
const POSITION_READERS: Record<string, string> = {
	'src/lib/selection/range-bytes.ts':
		'`rangeRead` vouches the blocks its paths name; the layout it hands on paints and places',
	'src/lib/editor-actions/commit/draft-registry.svelte.ts':
		'a commit vouches the blocks its ranges name before it reads a start',
	'src/lib/editor-actions/commit/byte-splice.ts':
		'the splice vouches what its reading took; its other reads place a caret',
	'src/lib/editor-actions/commit/history.ts':
		'the reading is vouched and made again; its other read places a caret',
	'src/lib/editor-actions/commit/undo-controller.ts':
		'takes the version’s list for an undo snapshot, and no position',
	'src/lib/selection/cross-block/range-removal.ts':
		'places the caret a removal leaves, after its `rangeRead`',
	'src/lib/selection/cross-block/range-replace.ts':
		'names the place a removal emptied, for the caret',
	'src/lib/components/Editor.svelte': 'the overlay’s paint and the test door, which write no byte'
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
				'a new range gesture: take its range and its document from `rangeRead`, which vouches the blocks it names and reaches',
			hits: ['rangeHost(ctx.reading, read)'],
			misses: ['const host: RangeHost = hostOf(read);']
		},
		{
			id: 'exactly the declared files take a position off the kept starts',
			matches: /\b(?:bytes|deps)\.(?:measured|layout)\(\)/,
			declared: POSITION_READERS,
			reason:
				'a new reader of a position: vouch the blocks its paths name before a byte made from one is written or copied (`rangeRead`, `KeptStarts.vouch`), or say that it writes none',
			hits: ['const now = deps.measured();', 'pointAtByte(ctx.bytes.measured(), at)'],
			misses: ['const { starts } = read.measured;', '// bytes.layout() is laid out once']
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
