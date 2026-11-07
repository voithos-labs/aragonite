/**
 * G4.315: under `selection/`, a range becomes bytes in one file, `range-bytes.ts`, the adapter the
 * range-edit core reads every range through. A second byte reading drifts from the one the core
 * was handed.
 */

import { describeFileRules, under, type FileRule } from './file-rule';
import { collectEditorSources } from './scan-source';
import { SOURCE, SOURCE_DIR } from './source-paths';

const ROGUE = 'src/lib/selection/rogue.ts';

const SELECTION_BYTES: FileRule = {
	id: 'G4.315 a range is read as bytes only in selection/range-bytes.ts',
	population: under(SOURCE_DIR.selection),
	matches: /\b(?:byteOf\w*|leafAtByte|documentByteMap)\s*\(/,
	allowed: {
		'src/lib/selection/range-bytes.ts': 'the adapter: a selection read as the bytes the core takes'
	},
	reason:
		'a range read as bytes anywhere else can disagree with what the copy and the cut were handed: read it through rangeBytes',
	reaches: [SOURCE.rangeBytes],
	hits: [
		{ relPath: ROGUE, code: 'const at = layout.byteOf(path, offset);' },
		{ relPath: ROGUE, code: 'documentByteMap(doc).leafAt(byte)' }
	],
	misses: [
		{ relPath: ROGUE, code: 'rangeBytes(doc, source, coverage)' },
		{ relPath: ROGUE, code: 'const byteOffset = 3;' }
	]
};

describeFileRules([SELECTION_BYTES], collectEditorSources());
