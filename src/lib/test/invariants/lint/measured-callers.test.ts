/**
 * G4.340: `measured(doc)` measures every top-level block of the document it's handed, so a caller
 * that hands it the editor's own document sums the whole document where the kept starts would
 * answer from their record. Every caller is declared with the document it measures.
 */

import { callSites, collectEditorSources } from './scan-source';
import { describeManifests } from './file-rule';

describeManifests(
	[
		{
			id: 'G4.340 every caller of `measured` hands it a document the editor keeps no starts for',
			// A call with its document; `measured()` with none is a member's declaration.
			matches: (file) => callSites(file.code, 'measured').some((site) => !!site.args?.trim()),
			declared: {
				'src/lib/editor-actions/commit/kept-starts.ts':
					'the record’s answer to a read inside a write, which the record can’t give',
				'src/lib/editor-actions/commit/history.ts': 'an undo entry’s snapshot',
				'src/lib/editor-actions/commit/change-record.ts': 'one top-level block, alone',
				'src/lib/tree-operations/spliced-openers.ts': 'one container’s run of children',
				'src/lib/range-edit/host.ts': 'a range edit’s parse of its answer, or a tree it was handed',
				'src/lib/testing/conformance-core.ts': 'the conformance kit’s own parse',
				'src/lib/testing/inline-menu-conformance.ts': 'the kit’s stand-in host document'
			},
			reason:
				'a new caller of `measured` sums every top-level block of its document: read the editor’s own through `deps.bytes.measured()`, or declare what this document is',
			hits: ['const laid = measured(doc);', 'documentLayout(measured(deps.doc));'],
			misses: [
				'const at = deps.bytes.measured();',
				'deps.oracle.measured(id) ?? estimate;',
				'\tmeasured(): Measured;',
				'\tmeasured(id: string): number | undefined;',
				'export function measured(doc: DocumentView): Measured {',
				"import { measured } from './top-level-starts';"
			]
		}
	],
	collectEditorSources()
);
