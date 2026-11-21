/**
 * G4.170: a table row's header flag is written only where a row's position is known, the parser
 * and the table's rebuild, so no route that adds, moves or removes rows can leave it on another row.
 */

import { describeManifests, except } from './file-rule';
import { collectEditorSources } from './scan-source';
import { SOURCE } from './source-paths';

describeManifests(
	[
		{
			id: 'G4.170 only the parser and the table rebuild write a row’s header flag',
			// The node's type and the published one declare the field.
			population: except(SOURCE.cstNodes, SOURCE.builtinData),
			matches: /\bisHeader\s*:(?!:)|[{,]\s*isHeader\s*[,}]|\.isHeader\s*=(?!=)/,
			declared: {
				[SOURCE.tableParser]: 'reads each row at its line',
				[SOURCE.containerRebuilders]: 'makes row 0 the header after every structural edit'
			},
			reason:
				'the header is whichever row is first, so a route that sets the flag itself goes stale the moment a row moves; build the row with `tableRowOf` and let the table rebuild decide',
			hits: [
				"const row = { kind: 'tableRow', metadata: { isHeader: i === 0 } };",
				'const metadata = { isHeader, surplusCells };',
				"metadataOf(rows[0], 'tableRow').isHeader = true;"
			],
			misses: [
				'if (meta?.isHeader === true) return;',
				'if (row.isHeader == null) return;',
				'const isHeader = rowIdx === 0;'
			]
		}
	],
	collectEditorSources()
);
