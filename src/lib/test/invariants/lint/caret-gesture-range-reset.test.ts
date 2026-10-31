/**
 * Placing the caret ends a live cross-block range unless the gesture is extending one (G2.12).
 * `BlockComponent.focus` covers programmatic placement; this scan covers the rest: every click the
 * browser places a caret for resets the range first, only extend paths call `parkCaret`, and every
 * block forwarding `focus` forwards `parkCaret` too (a container through its `containerApi`).
 */

import { it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';
import { describeFileRules, describeManifests } from './file-rule';
import { SOURCE } from './source-paths';

/** The range reset (the pointerdown preamble) a caret-placing click runs first. */
const RESET_RE = /\bresetForPointerDown\s*\(/;
/** The delegating call: a block handing its click to the cross-block dispatcher,
 *  whose own preamble is the reset. */
const DELEGATE_RE = /\bcrossBlock\.handlePointerDown\s*\(/;
/** A click handler of any spelling, including the bundle key (`onpointerdown:`) a leaf hands a
 *  plugin component and a spread of the leaf's `renderProps`, which binds one without naming it. */
const POINTER_HANDLER_RE =
	/\bon(pointerdown|mousedown)\s*[=:]|['"](pointerdown|mousedown)['"]|\brenderProps\b/;
/** A call to `parkCaret`, optional-call spelling included. A bare forward
 *  (`export const parkCaret = leaf.parkCaret;`) makes no call and is not a caller. */
const PARK_CALL_RE = /\.parkCaret\s*\??\.?\s*\(/;
/** A block forwarding the shared caret module's public method. The `export` is required: an
 *  unexported `const focus = selection.focus` reads the selection endpoint instead. */
const FOCUS_FORWARD_RE = /\bexport const focus = ((?:\w+\.)*\w+)\.focus\s*;/g;
/** A call to a container factory, the thing that builds a whole
 *  `ContainerBlockComponent`, both caret functions included. */
const CONTAINER_SEAM_RE = /\bcreateContainerBlock(?:Component)?\s*\(/;
/** The `containerApi` export, in either spelling; the `export` keyword is required for the
 *  same reason as above: `bind:this` reads instance exports. */
const CONTAINER_API_EXPORT_RE =
	/\bexport\s+(?:const\s+containerApi\s*=|\{[^}]*\bcontainerApi\b[^}]*\})/;

type Door = 'reset' | 'delegate' | 'both';

/** Defines the preamble, and binds the mousedown that places a press in a surface's padding. */
const PREAMBLE_MODULE = SOURCE.pointerPreamble;

/** These build the editable element, so a factory call here defines it rather than publishing. */
const CONTAINER_SEAM_MODULES: string[] = [SOURCE.containerBlockComponent, SOURCE.pluginContainer];

/** Gestures whose caret the browser places, and the call or calls each one has to make. */
const CARET_GESTURE_DOORS: Record<string, Door> = {
	[PREAMBLE_MODULE]: 'reset',
	// Two calls: a Shift+click between cells ends the range itself, and every other press delegates.
	'src/lib/components/blocks/table/TableCellBlock.svelte': 'both',
	'src/lib/components/blocks/text/TextEditableBlock.svelte': 'delegate',
	'src/lib/components/blocks/code/CodeBlock.svelte': 'delegate',
	// Two calls: the dispatcher hit-tests against source text the rendered view does not have,
	// so the rendered view calls the preamble itself rather than delegating.
	'src/lib/components/blocks/editable/editable-leaf.ts': 'both',
	// The dead-space click (the root's own padding, the area below the last block) and the
	// margin drag, both of which land a caret the browser did not place.
	'src/lib/components/editor-root/gestures.ts': 'reset'
};

/** Click handlers that place no caret. A new click-handling file joins this map or the one
 *  above; there is no third answer. */
const NON_CARET_PRESS_FILES: Record<string, string> = {
	'src/lib/debug/input-recorder.ts': 'records the press into an input recording; places no caret',
	'src/lib/debug/input-recording.ts': 'names the press a recorded step opened on; places no caret',
	'src/lib/components/TailInsert.svelte':
		'swallows the press so no caret seats under it; the paragraph it mints focuses itself',
	'src/lib/components/menu/BlockMenu.svelte':
		'swallows the press on its rows so the caret it inserts at keeps focus',
	'src/lib/components/menu/InlineMenuHost.svelte':
		'swallows the press on its rows so the caret the pick writes at keeps focus',
	'src/lib/components/menu/SelectionToolbar.svelte':
		'swallows the press on its buttons so the selection they act on survives it; the release is only heard to place the bar',
	'src/lib/components/blocks/text/noted-press.ts':
		'ends a press reading when the next press starts; places no caret',
	'src/lib/components/SearchBar.svelte':
		'a press on the find bar between its controls focuses the field in that row; the document caret stays put',
	'src/lib/components/editor-root/listeners.ts':
		'the reveal-anchor release: a press on the scroll port drops the pin and touches no caret',
	'src/lib/caret/drawn-caret.svelte.ts':
		'arms the drawn caret’s paint at the next frame for a caret the press moves; places none',
	'src/lib/components/editor-root/focus.ts':
		'notes that a button is down so the preview modes paint markers on release; touches no caret',
	'src/lib/selection/multi-click.ts':
		'the second and third presses of a click run select the word or the surface under them: a selection gesture whose first press already went through the door',
	'src/lib/components/blocks/table/TableBlock.svelte':
		'the add-row and add-column strips swallow their press so the cell keeps the caret that pinned them',
	'src/lib/components/blocks/code/CodeBlockRail.svelte':
		'preventDefault on a language-list option so the field keeps focus long enough to commit the pick; the caret returns through the block’s own door afterwards',
	'src/lib/components/image/ImageOverlayHost.svelte':
		'widget selection + overlay placement; the caret stays where it was',
	'src/lib/components/image/ImageProperties.svelte':
		'document-capture dismiss-on-outside-press for the properties popover',
	'src/lib/components/menu/menu-presence.svelte.ts':
		'closes an open menu on a press outside it; the press places its own caret through the ordinary door',
	'src/lib/components/image/ImageResizeHandles.svelte': 'starts a resize drag',
	'src/lib/editor-actions/reorder-drag.ts': 'starts a block reorder drag off the handle',
	'src/lib/components/dom-block-view/DomBlockView.svelte':
		'binds the shared editable-leaf reveal handler on a render-primary view’s rendered half; the reset lives there',
	'packages/details/src/DetailsBlock.svelte':
		'preventDefault on the summary so the disclosure toggle takes no focus',
	'packages/latex/src/BlockMath.svelte':
		'binds the shared editable-leaf reveal handler; the reset lives there',
	'packages/parrot/src/ParrotBlock.svelte':
		'binds the shared editable-leaf reveal handler on its caption; the reset lives there',
	'packages/toc/src/TocBlock.svelte':
		'binds the shared editable-leaf reveal handler, plus entry navigation',
	'packages/mermaid/src/MermaidBlock.svelte':
		'stopPropagation on its toolbar and a diagram-surface press that selects the block',
	'src/routes/test/plugins/+page.svelte':
		'harness chrome — preventDefault on a mode toggle so the press takes no focus'
};

/** The only files allowed to call `parkCaret`. A new entry asserts the caller runs while an
 *  extend is growing a range; anything else wants `focus`. */
const PARK_DOOR_CALLERS: Record<string, string> = {
	'src/lib/selection/caret-landing.ts':
		'park — a range end a key moved (showSelectionEnd), given the caret once windowing unmounted the block holding it, while the extend still owns the range',
	'src/lib/editor-actions/container-block-component.ts':
		"implementation: the container walk lands through its child's park door",
	'src/lib/components/blocks/editable/editable-leaf.ts':
		"implementation: the leaf's park door over the shared surface",
	'src/lib/components/blocks/table/TableBlock.svelte':
		'implementation: the 2D park collapses to a cell park',
	'src/lib/components/blocks/table/TableRowBlock.svelte':
		'implementation: the row park collapses to its first cell'
};

/** Modules whose `focus` is forwarded without the matching exported `parkCaret` forward;
 *  `bind:this` reads instance exports, so an unexported forward is missing from the block's ref. */
function unforwardedParkSeams(code: string): string[] {
	const missing: string[] = [];
	for (const [, seam] of code.matchAll(FOCUS_FORWARD_RE)) {
		if (!code.includes(`export const parkCaret = ${seam}.parkCaret;`)) missing.push(seam);
	}
	return missing;
}

/** The caret gestures making a given call, each with what it does. */
function gesturesCalling(doors: Door[]): Record<string, string> {
	const entries = Object.entries(CARET_GESTURE_DOORS).filter(([, door]) => doors.includes(door));
	return Object.fromEntries(
		entries.map(([relPath, door]) => [relPath, `a caret gesture: ${door}`])
	);
}

const sources = collectEditorSources();

describeManifests(
	[
		{
			id: 'G2.12 every press handler in the tree places a caret or says what it does instead',
			matches: POINTER_HANDLER_RE,
			declared: { ...gesturesCalling(['reset', 'delegate', 'both']), ...NON_CARET_PRESS_FILES },
			reason:
				'a file grew a pointerdown/mousedown handler: add it to CARET_GESTURE_DOORS if it places ' +
				'a caret (and route it through resetForPointerDown), or to NON_CARET_PRESS_FILES saying ' +
				'what it does instead',
			hits: [
				'onpointerdown={handle}',
				'onpointerdown: onPointerDown,',
				"root.addEventListener('mousedown', h)"
			],
			misses: ["root.addEventListener('pointermove', h)", 'onpointerup={handle}']
		},
		// A file-level "either call" check would read a sibling handler's delegate call and pass a
		// rendered view that resets nothing, so each call has its own list.
		{
			id: 'G2.12 exactly the gestures declared to end the range themselves call the preamble',
			matches: RESET_RE,
			declared: gesturesCalling(['reset', 'both']),
			reason:
				'a file ends the range without being declared a caret-placing gesture, or stopped ending it',
			hits: ['resetForPointerDown(selection, caretMemory, e.shiftKey)'],
			misses: ['if (crossBlock.handlePointerDown(e)) return;', '// resetForPointerDown(a, b, c)']
		},
		{
			id: 'G2.12 exactly the gestures declared to delegate hand their press to the dispatcher',
			matches: DELEGATE_RE,
			declared: gesturesCalling(['delegate', 'both']),
			reason:
				'a press reached the cross-block dispatcher undeclared, or a gesture stopped delegating',
			hits: ['if (crossBlock.handlePointerDown(e)) return;'],
			misses: ['resetForPointerDown(a, b, c);', 'if (handlePointerDown(e)) return;']
		},
		{
			id: 'G2.12 only declared extend paths and caret implementations call parkCaret',
			matches: PARK_CALL_RE,
			declared: PARK_DOOR_CALLERS,
			reason:
				'a file reached through `parkCaret`: it must be a selection-extend path (placing the caret ' +
				'while the range is still growing) or a caret-writer implementation. Anything else ' +
				'wants `focus`, which ends the range.',
			hits: [
				'ref.parkCaret?.(offset)',
				'surface.parkCaret(offset)',
				'refs[last]?.parkCaret?.(FOCUS_LAST_START)'
			],
			misses: [
				'export const parkCaret = leaf.parkCaret;',
				'export function parkCaret(offset: number): void {'
			]
		},
		{
			id: 'G2.12 every container publishes its surface as one containerApi instance export',
			matches: (file) =>
				CONTAINER_SEAM_RE.test(file.code) && !CONTAINER_API_EXPORT_RE.test(file.code),
			declared: {
				...Object.fromEntries(
					CONTAINER_SEAM_MODULES.map((relPath) => [relPath, 'builds the editable element itself'])
				),
				[SOURCE.domBlockView]: 'publishes the factory’s containerApi whole, through viewRef'
			},
			reason:
				'a container calls the shared caret factory but publishes no `containerApi` instance export. ' +
				'BlockHost resolves a container ref through that one export, so without it the block ' +
				'publishes a surface with no verbs: no focus, and no `parkCaret` for an extend.',
			// A destructure alone exports nothing, nor does a local that lost its `export`, nor a
			// neighbouring export.
			hits: [
				'const { blockListProps, containerApi } = createContainerBlock({',
				'const containerApi = createContainerBlock({',
				'export { blockListProps };\nconst api = createContainerBlockComponent({'
			],
			misses: [
				'const { containerApi } = createContainerBlock({\nexport { containerApi };',
				'const { blockListProps, containerApi } = createContainerBlock({\nexport { blockListProps, containerApi };',
				'export const containerApi = createContainerBlock({'
			]
		}
	],
	sources
);

describeFileRules(
	[
		{
			id: 'G2.12 a block forwarding a shared helper’s focus forwards its parkCaret too',
			matches: (file) => unforwardedParkSeams(file.code).length > 0,
			reason:
				'a block forwards a shared caret helper’s `focus` without its `parkCaret`. parkCaret is ' +
				'optional on BlockComponent, so this type-checks, and every extend that lands on ' +
				'the block silently fails to place the caret.',
			// The module has to match, and the forward has to be exported: `satisfies BlockComponent`
			// can't see a dropped `export` and the member is optional.
			hits: [
				'export const focus = leaf.focus;',
				'export const focus = editableSurface.surface.focus;\nexport const parkCaret = other.parkCaret;',
				'export const focus = leaf.focus;\nconst parkCaret = leaf.parkCaret;'
			],
			misses: [
				'export const focus = leaf.focus;\nexport const parkCaret = leaf.parkCaret;',
				'const focus = ctx.selection.focus;'
			]
		}
	],
	sources
);

// The probes prove both matchers on snippets; these prove each still reads real blocks.
it('the container sweep finds container components', () => {
	const containers = sources.filter(
		(f) => CONTAINER_SEAM_RE.test(f.code) && !CONTAINER_SEAM_MODULES.includes(f.relPath)
	);
	expect(containers.length).toBeGreaterThan(0);
});

it('the forward check finds blocks forwarding a shared helper’s focus', () => {
	const forwarding = sources.filter((f) => [...f.code.matchAll(FOCUS_FORWARD_RE)].length > 0);
	expect(forwarding.length).toBeGreaterThan(0);
});
