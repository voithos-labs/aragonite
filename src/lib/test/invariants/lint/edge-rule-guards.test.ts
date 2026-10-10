/**
 * The edge rule's source guards. Which side of a hidden edge the next letter takes is decided in
 * one place, the edge resolver, from the caret memory's records; no other file reads a side or
 * keeps an arrival (G4.150). A click's side is checked once, from the shared click entry both prose
 * blocks go through, and neither block measures the press against its text itself (G4.151).
 */

import { describe, expect, it } from 'vitest';
import { describeFileRules, describeManifests } from './file-rule';
import { balancedBlock, collectEditorSources, readSource } from './scan-source';

const RESOLVER = 'src/lib/components/blocks/text/edge-seat.ts';
const CHIP_STEP = 'src/lib/components/blocks/text/edge-step.ts';
const CLICK_ENTRY = 'src/lib/components/blocks/text/widget-interaction.ts';
const CLICK_SIDE = 'src/lib/components/blocks/text/click-side.ts';
const BLOCKS = [
	'src/lib/components/blocks/text/TextEditableBlock.svelte',
	'src/lib/components/blocks/table/TableCellBlock.svelte'
];

// ── G4.150 one placer for a hidden edge ─────────────────────────────────────

// Spelled in parts, so this file's own probes are not an arrival side.
const NEAR = ['ne', 'ar'].join('');
const FAR = ['f', 'ar'].join('');
const ARRIVAL = ['classify', 'Arrival', 'Key'].join('');

describeFileRules(
	[
		{
			id: 'G4.150 no arrival side is kept or read',
			matches: new RegExp(`['"](?:${NEAR}|${FAR})['"]|\\b(?:ArrivalSide|${ARRIVAL})\\b`),
			reason:
				'the next letter follows the character before the caret, so how the caret arrived means nothing; a route that needs another answer adds a record to the caret memory, which the edge resolver reads',
			hits: [
				`settleSide('${NEAR}');`,
				`if (side === "${FAR}") return run.end;`,
				`const action = ${ARRIVAL}(e.key);`
			],
			misses: ["block: 'nearest'", `// the ${NEAR} side went with the arrival`]
		}
	],
	collectEditorSources()
);

describeManifests(
	[
		{
			id: 'G4.150 only the edge resolver and the chip step read the caret’s side',
			matches: /\.side\(\)/,
			declared: {
				[RESOLVER]: 'places every insertion by the caret memory’s records',
				[CHIP_STEP]: 'reads which of a code chip’s two stops the bar is on, to step to the other'
			},
			reason:
				'the side is a record only the edge resolver turns into an offset; a route reading it decides a hidden edge a second time',
			hits: ['const steppedIn = caretMemory.side() !== null;'],
			misses: ['const side = record;']
		},
		{
			id: 'G4.150 only the edge resolver picks a boundary of a hidden edge',
			matches: /\b(?:resolveEdgeSeat|typingOffset)\s*\(/,
			declared: { [RESOLVER]: 'the resolver itself, and the reads it offers the block' },
			reason:
				'every insertion, the chord’s seat and the look already ask the resolver through the block’s placement; a second caller is a second copy of the rule',
			hits: ['const at = typingOffset(caret, inlines, null, raw, screen, reading);'],
			misses: ['placement.offsetFor(caret, typed);']
		}
	],
	collectEditorSources()
);

// ── G4.151 one click-side check ─────────────────────────────────────────────

const CLICK_SIDE_CALL = /\bclickSide\s*\(/;

describeManifests(
	[
		{
			id: 'G4.151 the click-side check runs from the shared click entry only',
			matches: CLICK_SIDE_CALL,
			declared: {
				[CLICK_SIDE]: 'the check itself',
				[CLICK_ENTRY]: 'the click entry both prose blocks’ `onClick` go through'
			},
			reason:
				'a click past a line’s end or beside a code chip is one decision; a block asking it itself decides it twice, and a third surface would ask neither',
			hits: ['const side = clickSide(el, x, y);'],
			misses: ['const side = clickSideOf;']
		}
	],
	collectEditorSources()
);

/** Reads a block's `onClick` may not make: measuring a press against text is the check's job. */
const MEASURES_TEXT =
	/\b(?:getClientRects|getBoundingClientRect|caretRangeFromPoint|caretPositionFromPoint|caretSeatInElement|visualLines?\w*)\s*\(/;

/** The body of `function onClick(` in `code`, or null. */
function onClickBody(code: string): string | null {
	const decl = /\bfunction onClick\s*\([^)]*\)[^{]*\{/.exec(code);
	return decl ? balancedBlock(code, decl.index + decl[0].length) : null;
}

describe('G4.151 neither prose block measures a click against its text', () => {
	it.each(BLOCKS)('%s', (relPath) => {
		const body = onClickBody(readSource(relPath).code);
		expect(body, 'the block has an onClick').not.toBeNull();
		expect(
			MEASURES_TEXT.exec(body!)?.[0] ?? null,
			'a press measured here skips the click-side check every block shares'
		).toBeNull();
	});

	it('reads the onClick body and flags a measure in it', () => {
		const measured = 'function onClick(e) {\n\tconst r = el.getBoundingClientRect();\n}\n';
		expect(MEASURES_TEXT.test(onClickBody(measured)!)).toBe(true);
		const passed = 'function onClick(e) {\n\tsnap(e.clientX);\n}\nel.getClientRects();';
		expect(MEASURES_TEXT.test(onClickBody(passed)!)).toBe(false);
	});
});
