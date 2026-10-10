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
/** The files that pass the caret memory's record on without reading it. */
const CARRIERS = ['src/lib/caret/held-space.ts', 'src/lib/caret/next-insertion.ts'];
/** The files that decide a hidden edge. */
const EDGE_FILES = [
	RESOLVER,
	CHIP_STEP,
	'src/lib/components/blocks/text/next-byte.ts',
	'src/lib/caret/held-space.ts'
];
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
		},
		{
			id: 'G4.150 the edge rule reads the policy row, never a kind name',
			population: (file) => EDGE_FILES.includes(file.relPath),
			matches: /\bkind\s*[!=]==\s*'(?!text')\w+'/,
			reason:
				'a mark and the code chip differ at an edge by their `edgeAffinity` row; a branch on a kind name is a second table a plugin kind never joins',
			reaches: EDGE_FILES,
			hits: [{ relPath: RESOLVER, code: "if (run.kind === 'inlineCode') return run.end;" }],
			misses: [{ relPath: RESOLVER, code: "if (node.kind === 'text') return false;" }]
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
		},
		{
			id: 'G4.150 only the record’s home, its holder, its carriers and the resolver name it',
			matches: /\bEdgeAffinity\b/,
			declared: {
				'src/lib/caret/edge-affinity.ts': 'defines the record',
				'src/lib/caret/caret-memory.ts': 'holds it and tells a change from none',
				[CARRIERS[0]]: 'keeps the record a held space was opened with, for the letter it carries',
				[CARRIERS[1]]: 'hands the record a write was held at to the block’s placement',
				[RESOLVER]: 'turns it into an offset'
			},
			reason:
				'the record is read in one place, the edge resolver; a new file taking it is a second reader, so it routes through `TypedPlacement` or joins this list as a carrier',
			hits: ["import type { EdgeAffinity } from '../caret/edge-affinity';"],
			misses: ['const affinity = edgeAffinityOf(kind);']
		},
		{
			id: 'G4.150 only the code block’s language picker asks whether a key moved the caret',
			matches: /\barrivedByKey\b/,
			declared: {
				'src/lib/caret/caret-memory.ts': 'answers it',
				'src/lib/testing/headless-actions.ts': 'answers no for a block with no caret',
				'src/lib/components/blocks/code/CodeBlock.svelte':
					'offers the language picker only to a caret the user didn’t arrow into the fence'
			},
			reason:
				'how the caret arrived decides no hidden edge; a placement reading it brings the arrival side back',
			hits: [
				'const record = deps.caretMemory.arrivedByKey() ? null : deps.caretMemory.side();',
				'const keyed = deps.caretMemory.arrivedByKey?.();'
			],
			misses: ['const arrived = arrivedByKeyCount;']
		}
	],
	collectEditorSources()
);

describeFileRules(
	[
		{
			id: 'G4.150 a carrier of the record never branches on it',
			population: (file) => CARRIERS.includes(file.relPath),
			matches: /['"]outside['"]|\bside\s*[!=]==|\bside\??\.offset\b/,
			reason:
				'a held space and the insertion records only pass the record on; deciding by it there is a second edge rule beside `edge-seat.ts :: seatAt`',
			reaches: CARRIERS,
			hits: [
				{
					relPath: CARRIERS[1],
					code: "const at = side === 'outside' && at0 !== null ? at0 : at0;"
				},
				{ relPath: CARRIERS[0], code: 'const inside = side?.offset ?? at;' }
			],
			misses: [{ relPath: CARRIERS[1], code: 'place(before, edit, at, side, caret)' }]
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
