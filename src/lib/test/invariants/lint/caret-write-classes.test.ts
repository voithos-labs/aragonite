/**
 * G4.389: every place the editor writes a caret at a raw offset says which kind of caret it is. An
 * arrival is put down with no byte in hand (a landing from another line, Home, a click, a collapse,
 * a page step), and on a `:::` row in live mode it rests no earlier than the title's start, so its
 * function reads `browser/offsets.ts :: arrivalRawStart` or a reader of it. A step moves from where
 * the caret stood. An exact write puts back a byte its caller holds (a stored selection, a render,
 * an edit's caret). A new write fails here until its function is listed with its kind.
 */

import { describe, it, expect } from 'vitest';
import {
	balancedBlock,
	balancedCall,
	collectEditorSources,
	LIBRARY_ROOTS,
	readSource
} from './scan-source';
import { describeCallSiteRules, type CallSiteRule } from './call-site-rule';
import { SOURCE_DIR } from './source-paths';

const BLOCKS = SOURCE_DIR.blocks;
const SEL = 'src/lib/selection/';

/** The functions that write a caret, each reason opening with its kind. */
const CLASSED: Record<string, string> = {
	[`${BLOCKS}editable/editable-surface.ts :: parkCaret`]:
		'arrival: every landing from outside the block, the start code resolved to the arrival start',
	[`${BLOCKS}editable/editable-surface.ts :: focusAtColumn`]:
		'arrival: a vertical arrow from another line, its column scan floored at the arrival start',
	[`${SEL}motion-keys.ts :: handleMotion`]:
		'arrival: Home and Mod+Home stop at `arrivalFloor`, and a word key over a range starts from `leftEdgeArrival`; the character and word keys are steps',
	[`${SEL}shared-keydown.ts :: collapseRangeForArrow`]:
		'arrival: ArrowLeft over a range whose start an arrival put before the arrival start lands there; a start steps left stays',
	[`${SEL}keyboard-extend.ts :: moveByPage`]: 'arrival: a page step’s hit, floored',
	[`${BLOCKS}text/widget-interaction.ts :: snapToPress`]:
		'arrival: a click on the block, floored; beside a widget, the seat the press read',
	[`${SEL}motion-keys.ts :: moveToLineEdge`]:
		'step: the line edge the browser’s own move finds, for End too; `handleMotion` floors Home after it',
	[`${SEL}motion-keys.ts :: stepBesideWidget`]:
		'step: a vertical arrow inside the block, from beside a widget',
	[`${BLOCKS}text/widget-interaction.ts :: leaveWidget`]: 'step: an arrow out of a widget',
	[`${BLOCKS}table/TableCellBlock.svelte :: enterWidget`]: 'step: an arrow into a widget',
	[`${SEL}keyboard-extend.ts :: moveFocusTo`]: 'exact: a range folded back into one block',
	[`${SEL}native-bridge.ts :: applyCollapsedCaret`]: 'exact: a stored selection’s caret',
	[`${SEL}native-bridge.ts :: placeRestoredSelection`]: 'exact: a stored selection’s caret',
	[`${SEL}caret-landing.ts :: landCaret`]: 'exact: a stored selection’s caret, through the block',
	[`${SEL}caret-restore.ts :: restore`]: 'exact: a selection saved before a field took focus',
	[`${SEL}round-trip-restore.ts :: createRoundTripRestore`]: 'exact: a mode switch’s caret',
	[`${SEL}widget-caret.ts :: writeWidgetCaret`]: 'exact: the hidden caret a selected widget keeps',
	[`${SEL}cross-block/range-indent.ts :: restoreRange`]: 'exact: the range an indent kept',
	[`${SEL}cross-block/range-paste.ts :: endRangeAt`]: 'exact: a paste’s caret',
	[`${SEL}cross-block/range-paste.ts :: writeLeaf`]: 'exact: a paste’s caret',
	[`${SEL}cross-block/range-replace.ts :: place`]: 'exact: a replacement’s caret',
	['src/lib/components/Editor.svelte :: setSelection']: 'exact: the host’s bytes',
	['src/lib/components/Editor.svelte :: step']:
		'exact: the selection a block type’s command ran over, back once its writes land',
	['src/lib/components/editor-root/mode-flip.ts :: restoreAfterFlush']:
		'exact: a mode switch’s caret',
	['src/lib/editor-actions/commit/history.ts :: install']: 'exact: undo and redo',
	['src/lib/editor-actions/commit/undo-controller.ts :: place']: 'exact: an undo step’s caret',
	['src/lib/caret/reveal-source.ts :: placeCaret']: 'exact: a shown source’s offset',
	[`${BLOCKS}editable/surface-backend.ts :: setRaw`]: 'exact: the offset its caller resolved',
	[`${BLOCKS}editable/surface-backend.ts :: clampOutOfMarkerPrefix`]:
		'exact: a caret inside the marker prefix, put at the raw 0 it means',
	[`${BLOCKS}editable/editable-leaf.ts :: createSourceLeaf`]:
		'exact: an edit’s caret, and the landing `parkCaret` resolved',
	[`${BLOCKS}code/CodeBlock.svelte :: <module>`]:
		'exact: an edit’s caret, and the landing `parkCaret` resolved',
	[`${BLOCKS}code/CodeBlock.svelte :: onBeforeInput`]: 'exact: an edit’s caret',
	[`${BLOCKS}text/TextEditableBlock.svelte :: <module>`]:
		'exact: an edit’s caret, and the landing `parkCaret` resolved',
	[`${BLOCKS}text/TextEditableBlock.svelte :: landRestoredCaret`]:
		'exact: a stored selection’s caret',
	[`${BLOCKS}text/text-render.ts :: restoreCaret`]: 'exact: the caret a render carried',
	[`${BLOCKS}text/typed-input.ts :: <module>`]: 'exact: a typed edit’s caret',
	[`${BLOCKS}text/widget-interaction.ts :: restoreCaret`]: 'exact: the offset its caller resolved',
	[`${BLOCKS}table/TableCellBlock.svelte :: <module>`]:
		'exact: an edit’s caret, a stored one, and the landing `parkCaret` resolved',
	[`${BLOCKS}table/cell-pointer.ts :: extendTo`]:
		'exact: the offset a press in a cell’s padding hit, where no `:::` row can stand',
	[`${BLOCKS}table/cell-render.ts :: render`]: 'exact: the caret a render carried'
};

const KINDS = /^(arrival|step|exact): /;
// The predicate, and the readers that hand it on.
const FLOOR =
	/\b(arrivalRawStart|arrivalStart|arrivalFloor|leftEdgeArrival|pageArrival|CURSOR_START)\b/;
const ROGUE = `${BLOCKS}x/rogue.ts`;

const WRITES: CallSiteRule = {
	id: 'G4.389 every caret write names its kind',
	calls: [
		'.placeCaretAtRaw',
		'.placeUnshownCaret',
		'.setRaw',
		'.landCaret',
		'.restoreCaret',
		'.landRestoredCaret',
		'.caretLanding.restore',
		'caretLanding.restore',
		'.landing.restore',
		'deps.restore'
	],
	holds: () => false,
	allowed: CLASSED,
	reason:
		'say whether the caret is an arrival, a step or an exact byte; an arrival reads `arrivalRawStart` (`caret-placement.md` § 3)',
	hits: [
		{
			relPath: ROGUE,
			code: 'function land(el) {\n\tw.placeCaretAtRaw(el, 0, { clamp: "exact" });\n}'
		},
		{
			relPath: ROGUE,
			code: 'function go() {\n\tvoid ctx.caretLanding.restore({ anchor: p, focus: p });\n}'
		}
	],
	misses: [
		{
			relPath: ROGUE,
			code: 'interface W {\n\tplaceCaretAtRaw(el: HTMLElement, raw: number): boolean;\n}'
		},
		{
			relPath: ROGUE,
			code: '// w.placeCaretAtRaw(el, 0) would land at the row start\nconst x = 1;'
		}
	]
};

// A landing's restore handed in as a parameter, so its calls read as a bare `restore`.
const HANDED_IN: CallSiteRule = {
	...WRITES,
	id: 'G4.389 a restore handed in names its kind',
	population: (file) => file.relPath === `${SEL}keyboard-extend.ts`,
	calls: ['restore'],
	allowed: {
		[`${SEL}keyboard-extend.ts :: collapseCrossBlock`]:
			'exact: a range’s own end, written while its row hides the name, so the reachable clamp puts it past'
	},
	hits: [
		{
			relPath: `${SEL}keyboard-extend.ts`,
			code: 'async function f(restore) {\n\tawait restore(x);\n}'
		}
	],
	misses: [
		{ relPath: `${SEL}keyboard-extend.ts`, code: 'async function f(l) {\n\tawait l.restore(x);\n}' }
	]
};

describeCallSiteRules([WRITES, HANDED_IN], collectEditorSources(LIBRARY_ROOTS));

/** The body of `function name` in `code`, or null where no such declaration stands. */
function functionBody(code: string, name: string): string | null {
	const at = new RegExp(`function\\s+${name}\\s*\\(`).exec(code);
	const params = at && balancedCall(code, at.index + at[0].length);
	if (!at || params === null) return null;
	const open = code.indexOf('{', at.index + at[0].length + params.length);
	return open < 0 ? null : balancedBlock(code, open + 1);
}

describe('G4.389 the kinds the list names', () => {
	it('every reason opens with its kind', () => {
		const unnamed = Object.entries(CLASSED).filter(([, why]) => !KINDS.test(why));
		expect(unnamed.map(([key]) => key)).toEqual([]);
	});

	it('every arrival is a function that reads the arrival start', () => {
		const unread = Object.entries(CLASSED)
			.filter(([, why]) => why.startsWith('arrival: '))
			.map(([key]) => key.split(' :: '))
			.filter(([relPath, name]) => !FLOOR.test(functionBody(readSource(relPath).code, name) ?? ''));
		expect(unread).toEqual([]);
	});
});
