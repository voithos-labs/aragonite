/**
 * Manifests over the shipped source: each row pins the files matching a pattern to a declared
 * list, in both directions, so a new writer, caller or reader is a decision and not a drift.
 * Where a declared file must also do something, that check sits beside its manifest as a file
 * rule under the same G-number. The scan is `file-rule.ts`.
 */

import { collectEditorSources, type SourceFile } from './scan-source';
import {
	describeFileRules,
	describeManifests,
	notUnder,
	type FileRule,
	type ManifestRule,
	type Probe
} from './file-rule';

const at = (relPath: string, code: string): Probe => ({ relPath, code });
const keys = (...groups: Record<string, string>[]) => groups.flatMap((g) => Object.keys(g));
const inKeys = (...groups: Record<string, string>[]) => {
	const paths = new Set(keys(...groups));
	return (file: SourceFile): boolean => paths.has(file.relPath);
};

// ── G4.21 / G4.34 the image and link byte writers ────────────────────────────

const IMAGE_BYTES = 'src/lib/components/image/image-source-bytes.ts';
const LINK_BYTES = 'src/lib/components/blocks/text/link-source-bytes.ts';
const IMAGE_POPOVER = 'src/lib/components/image/ImageProperties.svelte';

// ── G4.36 caret writes ───────────────────────────────────────────────────────

const namesToken = (token: string): RegExp => new RegExp(`(?<![\\w'"])${token}\\b`);

// ── G4.11 paste transforms ───────────────────────────────────────────────────

/** A call, excluding the declaration in the module that defines it. */
const TRANSFORMS_CALL = /(?<!function\s)\bapplyPasteTransforms\s*\(/;

/** Pulling a payload off a clipboard or a drop, keyed on the read and the carrier type rather
 *  than a receiver's name; `!.` tolerated, since that is how a new route is most often written. */
const CLIPBOARD_READ_RE =
	/[!?]?\.\s*getData\s*\(|[!?]?\.\s*files\b|\bDataTransfer\b|clipboard\s*[!?]?\s*\.\s*read(?:Text)?\s*\(/;

/** Each site reading external text, and the name that carries its text to a declared route.
 *  `editor-root-clipboard.ts` forwards the carrier and reads no payload of its own. */
const READ_SITE_ROUTES: Record<string, { handoff: string; why: string }> = {
	'src/lib/components/blocks/editable-surface.ts': {
		handoff: 'pasteTail',
		why: 'the shared paste handler hands the text to the block’s pasteTail, which dispatches through the paste tree-op'
	},
	'src/lib/components/menu/default-context-actions.ts': {
		handoff: 'applyPasteTransforms',
		why: 'the block menu’s "Replace with clipboard" reads through navigator.clipboard and runs the transforms itself before writing the block’s bytes'
	},
	'src/lib/components/menu/clipboard-actions.ts': {
		handoff: 'pasteTextInto',
		why: 'the menu paste reads through navigator.clipboard and re-dispatches the text as a paste event on the focused surface, whose handler is the editable-surface route above'
	},
	'src/lib/components/blocks/table/TableCellBlock.svelte': {
		handoff: 'pasteDispatch',
		why: 'the right-click menu paste has no ClipboardEvent to read, so it reads through navigator.clipboard and calls the paste tree-op directly'
	},
	'src/lib/components/paste-image-arm.ts': {
		handoff: 'handlePaste',
		why: 'the image-import handler reads the attachment payload and hands the hook’s markdown to the cross-block paste route'
	},
	'src/lib/selection/cross-block/paste.ts': {
		handoff: 'applyPasteTransforms',
		why: 'a declared route itself: runs the transforms before parsing the pasted slice'
	}
};

const readSiteRoles = Object.fromEntries(
	Object.entries(READ_SITE_ROUTES).map(([relPath, route]) => [relPath, route.why])
);

// ── G4.45 the bare tree-op primitives ────────────────────────────────────────

/** Keyed on the import rather than the call, so an alias (`splitNode as performSplit`) still
 *  enrolls its file. */
const IMPORTS_BARE_PRIMITIVE =
	/import\s*\{[^}]*\b(?:splitNode|deleteNode|mergeWithNext|mergeIntoPrevDeepLeaf)\b[^}]*\}\s*from\s*'[^']*(?:tree-operations|node-ops)/s;

/** The commit entries that settle the window afterwards, plus the two settle entries themselves;
 *  a leading dot is the norm here, since they are reached on a controller or a scope. */
const REACHES_SETTLE =
	/\b(commitStructural|commitMultiScope|commitContainer|settleSeparator|spliceChildrenSettled)\s*\(|\.\s*commit\s*\(/;

const BARE_PRIMITIVE_CALLERS: Record<string, string> = {
	'src/lib/editor-actions/block-edit-core.ts':
		'every split, merge and delete sits in a scope.commit mutate, whose settle runs after it',
	'src/lib/editor-actions/list-context.ts': 'the item split runs inside commitMultiScope',
	'src/lib/editor-actions/unwrap-strategies.ts': 'the unwrap merges run inside commitContainer',
	'src/lib/selection/range-delete-table-coverage.ts':
		'the table deletes run inside commitStructural'
};

// ── G4.37 the content-empty attribute ────────────────────────────────────────

const WALK_CONTAINER_SURFACES: Record<string, string> = {
	'src/lib/components/blocks/code/CodeBlock.svelte': 'the fenced-code surface',
	'src/lib/components/blocks/table/cell-render.ts': 'the table-cell surface',
	'src/lib/components/blocks/text/text-render.ts': 'the prose surface',
	'src/lib/components/blocks/editable-leaf.ts':
		'the plugin leaf surface, when its host paints source'
};

/** Files naming a renderer whose output no caret enters, so nothing reads the attribute back. */
const NON_EDITING_RENDERERS: Record<string, string> = {
	'src/lib/core/inline-render.ts': 'defines renderInlineNodes; the caller mounts the fragment',
	'src/lib/core/inline/visibility.ts':
		'renders into a detached fragment to read what paints, and mounts nothing',
	'src/lib/components/blocks/code/code-renderer.ts':
		'defines renderCodeBlock and hands the fragment back; the caller mounts it',
	'src/lib/testing/inline-conformance.ts':
		'measures the offset walk over a synthetic container the editor never mounts'
};

const SYNTHETIC_STAMPERS: Record<string, string> = {
	'src/lib/invariants/marker-css-parity.ts':
		'mounts a probe block carrying the attribute to compare the CSS against the walk'
};

// `renderSource` is the editable leaf's injected painter (`EditableLeafDeps.renderSource`).
const RENDERER_CALL = /(?<![\w'"])(renderInlineNodes|renderCodeBlock|renderSource)\s*\(/;
const STAMP_WRITE = /\.(?:toggle|set)Attribute\(\s*CONTENT_EMPTY_ATTR\b/;

// ── G4.30 hidden-run classification ──────────────────────────────────────────

const CLASSIFICATION_HOMES: Record<string, string> = {
	'src/lib/core/inline/visibility.ts': 'the families and the hiding rule',
	'src/lib/cursor/widget-offset.ts': 'applies them to a live DOM, and owns the reveal branches'
};

/** Resolving marker-hiding state either way: a DOM read of the mode root, the block-focus, construct
 *  or content-empty attributes, a marker class tested by selector, or a call to the rule itself. */
const CLASSIFICATION_RE =
	/(?:classList\.contains|closest|matches|querySelector(?:All)?)\s*\(\s*['"`][^'"`]*(?:md-marker|md-fence-line|md-ref-label|md-construct-reveal|data-construct-|data-presentation|data-focused|data-content-empty)|(?:get|has)Attribute\s*\(\s*['"`]data-(?:presentation|construct-|focused|content-empty)|(?<![\w.])(?:markerFamilyOf|familyHidesText|familyPaintsAlone)\s*\(/;

const NON_CLASSIFYING_READERS: Record<string, string> = {
	'src/lib/ambient/ambient-dom.ts':
		'marker-prefix span identity: a contenteditable="false" marker keeps its box, so the hidden-run rule excludes it by construction',
	'src/lib/components/blocks/text/construct-reveal.ts':
		'the preview-inline reveal writer: it stamps the class the classification reads, and asks nothing about hiding',
	'src/lib/invariants/marker-css-parity.ts':
		'the DEV probe comparing the two homes against the stylesheet, the opposite of holding a third answer'
};

const MARKER_CLASSES = [
	'md-marker',
	'md-fence-line',
	'md-ref-label',
	'md-construct-reveal',
	'directive-marker'
];

const MARKER_CLASS_FILES: Record<string, string> = {
	'src/lib/cursor/widget-offset.ts': 'the classification home',
	'src/lib/components/blocks/directive/DirectiveContainerBlock.svelte':
		'creates the directive container chrome: contenteditable="false" and outside every walk container, so the hiding classification excludes it twice over',
	'src/lib/ambient/ambient-dom.ts': 'creates and identifies the marker-prefix span',
	'src/lib/core/inline-render.ts': 'creates inline marker and ref-label spans',
	'src/lib/core/inline/visibility.ts': 'names the families the hiding rule is stated over',
	'src/lib/components/blocks/text/text-render.ts': 'creates the block-own prefix span',
	'src/lib/components/blocks/code/code-renderer.ts': 'creates fence marker and fence-line spans',
	'src/lib/plugins/latex/math-source.ts': 'creates the `$$` fence marker and fence-line spans',
	'src/lib/invariants/marker-css-parity.ts':
		'the DEV probe comparing the classification home against the stylesheet, one span per family'
};

/** A component's own CSS is the stylesheet half of this contract, not a second reader. */
const codeOutsideStyleBlocks = (file: SourceFile): string =>
	file.code.replace(/<style[\s\S]*?<\/style>/g, '');

// ── G4.33 live byte rewrites ─────────────────────────────────────────────────

const ORACLE_HOME = 'src/lib/core/inline/visibility.ts';
const SLOT_HOME = 'src/lib/schema/inline-construct-policy.ts';

/** The modules building live-mode byte candidates, each verifying through the render path. */
const REWRITE_MODULES: Record<string, string> = {
	[ORACLE_HOME]: 'the one home for what the reader sees',
	'src/lib/components/blocks/text/construct-edge-delete.ts': 'the destructive edge delete',
	'src/lib/components/blocks/text/edge-seat.ts': 'the typing position at a construct edge',
	'src/lib/components/blocks/text/link-source-bytes.ts': 'the link byte writer',
	'src/lib/components/blocks/text/live-join-seam.ts': 'the join cleaner',
	'src/lib/components/blocks/text/live-split-rebalance.ts': 'the split rebalancer',
	'src/lib/components/blocks/text/pending-mark-insert.ts': 'the pending-mark resolver',
	'src/lib/core/inline/format-toggle.ts': 'the format toggle'
};

/** Every file permitted to name `preDelete` at all; name-level equality closes the alias, bracket
 *  and helper-forward holes an endpoint-spelling matcher left open (#114). */
const PRE_DELETE_NAMERS: Record<string, string> = {
	'src/lib/tree-operations/paste-surfaces.ts': 'the surface contract declaring the parameter',
	'src/lib/tree-operations/paste/dispatch.ts': 'the request entry carrying the field to the hooks',
	'src/lib/tree-operations/paste/hooks.ts': 'the prose crossing into cutRangeFromDisplay',
	'src/lib/components/blocks/table/table-cell-paste.ts':
		'the cell crossing into cutRangeFromDisplay, ahead of the escaping sink',
	'src/lib/components/blocks/text/text-clipboard.ts': 'creates the range from its selection',
	'src/lib/components/blocks/code/CodeBlock.svelte': 'creates the range from its selection',
	'src/lib/components/blocks/table/TableCellBlock.svelte': 'creates the range from its selection',
	'src/lib/components/blocks/code/code-paste-surface.ts':
		'the one splicer: a fenced body has no inline constructs to clean'
};

/** Only the render-path reader in `visibility.ts` answers which marker spans a hiding mode drops;
 *  the rest create the class, identify their own span, or probe it. A component's `<style>` names classes to paint them,
 *  which G4.30's list holds, so `.svelte` files sit this rule out. */
const MARKER_FAMILY_NAMERS: Record<string, string> = {
	'src/lib/core/inline/visibility.ts':
		'the one module that states the families and drops what hides',
	'src/lib/core/inline-render.ts': 'creates the spans `visibility.ts` then reads back',
	'src/lib/cursor/widget-offset.ts':
		'identifies the marker-prefix widget, whose contenteditable="false" marker is no family of the rule',
	'src/lib/ambient/ambient-dom.ts': 'creates that same widget',
	'src/lib/components/blocks/text/text-render.ts': "creates the block's own prefix span",
	'src/lib/components/blocks/code/code-renderer.ts': 'creates the fence marker spans',
	'src/lib/plugins/latex/math-source.ts': 'creates the `$$` fence marker spans',
	'src/lib/invariants/marker-css-parity.ts': 'mounts one probe span per family for the DEV probe'
};

const ORACLE_CALL = /(?<![\w.])(?:renderedText|visibleRuns)\s*\(/;

// ── G4.12 caret-edge destructive keys ────────────────────────────────────────

const TEXT_BLOCK_DIR = 'src/lib/components/blocks/text/';
const DESTRUCTIVE_KEY_RE = /(['"])(?:Backspace|Delete)\1/;
const PREVENT_DEFAULT_RE = /\.preventDefault\s*\(/;

const EDGE_INTERCEPTORS: Record<string, string> = {
	'src/lib/components/blocks/text/edge-policy-dispatch.ts':
		'the one caret-edge dispatch: CST widget, decoration widget and marker-prefix overlap, each routed to updateBlockContent',
	'src/lib/components/blocks/text/widget-interaction.ts':
		'the selected-widget second-press delete, a selected-state handler ordered before the shared keymap'
};

// ── The manifests ────────────────────────────────────────────────────────────

const MANIFESTS: ManifestRule[] = [
	{
		id: 'G4.21 the image GFM serializer is named only inside the byte writer',
		matches: /\bbuildImageSourceBytes\b/,
		declared: { [IMAGE_BYTES]: 'the byte writer itself' },
		reason:
			'an inline handler may create a built-in image over syntax of its own; re-emitting its fields as GFM replaces the author’s bytes',
		hits: ['buildImageSourceBytes(fields)'],
		misses: ['// buildImageSourceBytes(fields)\n']
	},
	{
		id: 'G4.21 exactly the declared write paths call the image byte writer',
		matches: /\bbuildImageEditBytes\b/,
		declared: {
			[IMAGE_BYTES]: 'the byte writer itself',
			'src/lib/components/image/image-edit-commit.ts': 'the drag-resize and popover commit',
			'src/lib/components/image/image-widget-editing.ts': 'the Shift+Arrow keyboard resize'
		},
		reason: 'a new name is a new image write path: add it with its reason',
		hits: ['buildImageEditBytes(image, raw, fields)'],
		misses: ['buildLinkEditBytes(link, display, fields)']
	},
	{
		id: 'G4.34 the link GFM serializer is named only inside the byte writer',
		matches: /\bbuildLinkSourceBytes\b/,
		declared: { [LINK_BYTES]: 'the byte writer itself' },
		reason:
			'an inline handler may create a built-in link over syntax of its own; re-emitting its fields as GFM replaces the author’s bytes',
		hits: ['buildLinkSourceBytes(fields)'],
		misses: ['// buildLinkSourceBytes(fields)\n']
	},
	{
		id: 'G4.34 exactly the declared write paths call the link byte writer',
		matches: /\bbuildLink(?:Edit|Unwrap|Wrap)Bytes\b/,
		declared: {
			[LINK_BYTES]: 'the byte writer itself',
			'src/lib/components/link-card/link-card-commit.ts':
				'the card’s url commit, its remove-link, and the create wrap'
		},
		reason: 'a new name is a new link write path: add it with its reason',
		// The card takes the writer's answer as a prop, which this file-set scan cannot see.
		reaches: ['src/lib/components/link-card/LinkCard.svelte'],
		hits: [
			'buildLinkEditBytes(link, display, fields)',
			'buildLinkUnwrapBytes(link, display)',
			'buildLinkWrapBytes(display, start, end, url)'
		],
		misses: ['buildImageEditBytes(image, raw, fields)']
	},
	{
		id: 'G4.36 the files naming setRaw are the declared backends and caret writers',
		matches: namesToken('setRaw'),
		declared: {
			'src/lib/ambient/ambient-cursor.ts':
				'defines the raw write: the offset walk + the marker-prefix landing',
			'src/lib/components/blocks/editable-surface.ts':
				'the caret placement and column entries; the clamp to a position the caret can sit at lives here',
			'src/lib/components/blocks/plain-text-backend.ts':
				'the plugin-leaf backend over content offsets',
			'src/lib/components/blocks/code/CodeBlock.svelte':
				'its backend forward, plus the fence-line clamp correction after a column landing',
			'src/lib/components/blocks/table/TableCellBlock.svelte':
				'its backend forward; widget steps and the pending-cursor restore',
			'src/lib/components/blocks/text/TextEditableBlock.svelte':
				'its backend forward; the pending-cursor restore',
			'src/lib/components/blocks/text/widget-interaction.ts':
				'widget entry/exit positions beside an atomic inline widget'
		},
		reason:
			'a caret write is where a raw offset becomes a DOM position; a new writer must apply the clamp or forward to one that does (G2.12)',
		hits: [
			'deps.backend.setRaw(asRawOffset(0));',
			'setRaw: (offset) => write(offset),',
			'const write = io.setRaw;'
		],
		misses: ['// setRaw is the entry', 'const mySetRaw = 1;']
	},
	{
		id: 'G4.36 the files naming setToAmbientBoundary are the declared one',
		matches: namesToken('setToAmbientBoundary'),
		declared: {
			'src/lib/ambient/ambient-cursor.ts':
				'defines it; every other caller routes through a caret writer'
		},
		reason: 'the raw-0 landing under a marker prefix has one home',
		hits: ['setToAmbientBoundary(el);'],
		misses: ['// setToAmbientBoundary lands at raw 0']
	},
	{
		id: 'G4.36 the files writing the native selection are the declared ones',
		matches: /\.(addRange|setBaseAndExtent)\s*\(/,
		declared: {
			'src/lib/ambient/ambient-cursor.ts': 'the raw write lands as a native range',
			'src/lib/ambient/ambient-dom.ts': 'placeCaretAfterAmbientSpan, the shared boundary landing',
			'src/lib/components/blocks/code/CodeBlock.svelte': 'its setSelection range write',
			'src/lib/components/blocks/editable-surface.ts': 'the factory setSelection range write',
			'src/lib/components/blocks/text/edge-policy-dispatch.ts':
				'selects a replace widget whole: a range, not a caret position',
			'src/lib/components/blocks/text/widget-interaction.ts':
				"a double-click selects the revealed token whole, over the reveal's own text node",
			'src/lib/cursor/content-offsets.ts': 'setCursorOffset, the content-offset write helper',
			'src/lib/cursor/focused-caret.ts':
				'restoreCaretAtWalkOffset, the carry across a render rebuild',
			'src/lib/selection/caret-restore.ts': 'the menu-blur saved-range restore',
			'src/lib/selection/native-bridge.ts':
				'the SelectionPoint entry: the collapsed-caret clamp and the surface-content range live here'
		},
		reason: 'a native selection write outside the declared writers skips the clamp',
		hits: ['sel?.addRange(range);', 'sel.setBaseAndExtent(n, 0, n, 0);'],
		misses: ['sel.getRangeAt(0);']
	},
	{
		id: 'G4.36 the files naming the caret-write helpers are the declared ones',
		matches: /(?<![\w'"])(setCursorOffset|restoreCaretAtWalkOffset)\b/,
		declared: {
			'src/lib/cursor/content-offsets.ts': 'defines setCursorOffset',
			'src/lib/cursor/focused-caret.ts': 'defines restoreCaretAtWalkOffset',
			'src/lib/components/blocks/code/CodeBlock.svelte': 'DOM-first commit landing',
			'src/lib/components/blocks/editable-leaf.ts': 'pending restore + paste landing',
			'src/lib/components/blocks/plain-text-backend.ts': 'the backend write forward',
			'src/lib/components/blocks/table/cell-render.ts': 'render-rebuild caret carry',
			'src/lib/components/blocks/text/text-render.ts': 'render-rebuild caret carry',
			'src/lib/cursor/reveal-source.ts': 'reveal fold caret carry'
		},
		reason: 'the two helpers hide a native write the selection scan cannot see',
		hits: ['setCursorOffset(el, at);', 'restoreCaretAtWalkOffset(root, offset);'],
		misses: ['// setCursorOffset is the helper']
	},
	{
		id: 'G4.36 the files building a public focus from placeCaret are the declared surfaces',
		matches: /import\s*(?:type\s*)?\{[^}]*(?<!\w)placeCaret\b[^}]*\}\s*from\s*'[^']*caret-doors'/,
		declared: {
			'src/lib/components/blocks/editable-leaf.ts': 'the plugin leaf surface',
			'src/lib/components/blocks/editable-surface.ts': 'the shared editable factory',
			'src/lib/components/blocks/table/TableBlock.svelte': 'the cell-addressed grid surface',
			'src/lib/components/blocks/ThematicBreakBlock.svelte': 'the whole-block-focus leaf',
			'src/lib/editor-actions/container-block-component.ts': 'the container walk-in shim'
		},
		reason: 'a new surface building its focus is a new caret writer',
		hits: ["import { placeCaret } from '../../selection/caret-doors';"],
		misses: ["import { focusAtColumn } from '../../selection/caret-doors';"]
	},
	{
		id: 'G4.36 the files naming checkLandableCaret are the definition and its one caller',
		matches: namesToken('checkLandableCaret'),
		declared: {
			'src/lib/invariants/landable-caret.ts': 'defines the predicate',
			'src/lib/components/editor-root-focus.ts':
				'the editor root focusin listener: the one place the question is asked'
		},
		reason:
			'G1.33 fires once at the focus boundary every caret writer crosses; a per-writer copy re-opens the class',
		hits: ['checkLandableCaret(root);'],
		misses: ['// checkLandableCaret asks once']
	},
	{
		id: 'G4.11 exactly the declared sites call applyPasteTransforms',
		matches: TRANSFORMS_CALL,
		declared: {
			'src/lib/components/menu/default-context-actions.ts':
				'the block menu’s "Replace with clipboard": the clipboard text runs the transforms before it replaces the block’s bytes',
			'src/lib/selection/cross-block/paste.ts':
				'cross-block selection paste parses the pasted slice',
			'src/lib/selection/selection-drop.ts':
				'a dropped selection is a cut and a paste in one commit, so the moved bytes take the same rewrite',
			'src/lib/tree-operations/paste/dispatch.ts':
				'the paste tree-op parses the pasted text into blocks'
		},
		reason:
			'every clipboard-to-parse route runs applyPasteTransforms; a new site routes through a declared one or joins the list with a call',
		hits: ['const out = applyPasteTransforms(text);', 'parse(applyPasteTransforms(pasted))'],
		misses: [
			'export function applyPasteTransforms(text: string): string {',
			"import { applyPasteTransforms } from './paste-transforms';"
		]
	},
	{
		id: 'G4.11 every clipboard or drop read site is a declared route to the transforms',
		matches: CLIPBOARD_READ_RE,
		declared: readSiteRoles,
		reason:
			'a read that reaches parse() without a handoff to a declared route drops every plugin paste transform on that route',
		hits: [
			"const t = e.clipboardData.getData('text/plain'); parse(t);",
			'raw = await navigator.clipboard.readText();',
			"e.clipboardData?.getData('text/plain')",
			"e.dataTransfer?.getData('text/plain')",
			"e.clipboardData!.getData('text/plain')",
			'await navigator.clipboard!.readText()',
			'const items = await navigator.clipboard.read();'
		],
		// `deps.readText()` is `el.textContent`, not a clipboard read.
		misses: ['const text = deps.readText();']
	},
	{
		id: 'G4.45 the files importing a bare tree-op primitive are the declared callers',
		population: notUnder('src/lib/tree-operations/'),
		matches: IMPORTS_BARE_PRIMITIVE,
		declared: BARE_PRIMITIVE_CALLERS,
		reason: 'a new caller of the bare primitives: name the commit that settles its writes',
		hits: [
			"import { splitNode as performSplit } from '../tree-operations';",
			"import {\n\tdeleteNode,\n\tfocusTargetInReplacement\n} from '../tree-operations/settle';"
		],
		misses: [
			'blockEdit.mergeWithNext(index);',
			"import type { MergeResult } from '../tree-operations';"
		]
	},
	{
		id: 'G4.37 the files rendering into a caret-walk container are the surfaces and the non-editing renderers',
		matches: RENDERER_CALL,
		declared: { ...WALK_CONTAINER_SURFACES, ...NON_EDITING_RENDERERS },
		reason:
			'a surface mounting rendered chrome into a contenteditable without the content-empty attribute leaves a marker-only block invisible under live and preview-inline',
		hits: [
			'el.replaceChildren(renderInlineNodes(content, node.raw, opts));',
			'el.replaceChildren(renderCodeBlock(node));'
		],
		misses: ['// renderInlineNodes(…) builds the fragment\n', "const name = 'renderCodeBlock';"]
	},
	{
		id: 'G4.37 the files writing the content-empty attribute are the surfaces and the parity probe',
		matches: STAMP_WRITE,
		declared: { ...WALK_CONTAINER_SURFACES, ...SYNTHETIC_STAMPERS },
		reason: 'the attribute is written by exactly the surfaces that render into a walk container',
		hits: [
			'el.toggleAttribute(CONTENT_EMPTY_ATTR, holdsOnlyMarkerChrome(el));',
			"block.setAttribute(CONTENT_EMPTY_ATTR, '');"
		],
		misses: ['return root.hasAttribute(CONTENT_EMPTY_ATTR);']
	},
	{
		id: 'G4.30 only the one home resolves marker-hiding state',
		matches: (file) => CLASSIFICATION_RE.test(codeOutsideStyleBlocks(file)),
		declared: { ...CLASSIFICATION_HOMES, ...NON_CLASSIFYING_READERS },
		reason:
			'a file started reading the mode/reveal/marker vocabulary: route the question through visibility.ts, or declare what else it asks',
		hits: [
			"container.closest('[data-presentation]')",
			"el.getAttribute('data-presentation')",
			"el.closest('.block-host[data-focused]')",
			"el.hasAttribute('data-construct-start')",
			"el.classList.contains('md-construct-reveal')",
			"node.matches('.md-ref-label')",
			'familyHidesText(family, ctx)',
			'markerFamilyOf(el)',
			"el.closest('[data-content-empty]')",
			"block.hasAttribute('data-content-empty')"
		],
		misses: [
			"el.closest('.block-host')",
			"el.getAttribute('data-source-start')",
			at('x.svelte', '<style>:global(.md-marker) { display: none; }</style>')
		]
	},
	{
		id: 'G4.30 every file naming a marker class is declared with its role',
		matches: (file) => {
			const code = codeOutsideStyleBlocks(file);
			return MARKER_CLASSES.some((cls) => code.includes(cls));
		},
		declared: MARKER_CLASS_FILES,
		reason: 'a file started naming marker classes: declare its role',
		hits: ["const SEL = '.md-marker';", "el.classList.add('directive-marker');"],
		misses: [at('x.svelte', '<style>:global(.md-marker) { display: none; }</style>')]
	},
	{
		id: 'G4.33 every module naming the render-path oracle is a declared live rewrite',
		matches: ORACLE_CALL,
		declared: REWRITE_MODULES,
		reason:
			'a live byte rewrite is sound only because it asks the render path what the user sees; one more module asking is a decision, not a drift',
		hits: [
			'const v = renderedText(nodes, raw, ctx);',
			'for (const run of visibleRuns(nodes, raw, ctx))'
		],
		misses: ['// renderedText(x) is the entry']
	},
	{
		id: 'G4.33 every file naming an inline marker family is declared with what it does with it',
		population: (file) => !file.relPath.endsWith('.svelte'),
		matches: /['"][^'"]*md-(marker|ref-label)/,
		declared: MARKER_FAMILY_NAMERS,
		reason:
			'a file started naming marker classes: route the drop question through `visibility.ts`, or declare what it does instead',
		hits: [
			"el.querySelectorAll('.md-marker')",
			"const SEL = '.md-ref-label, b';",
			"el.classList.contains('md-marker')"
		],
		misses: ["el.querySelectorAll('.block')", at('x.svelte', "el.querySelectorAll('.md-marker')")]
	},
	{
		id: 'G4.33 the registered rewrite slots have exactly one reader',
		population: (file) => file.relPath !== SLOT_HOME,
		matches: /(?<![\w.])(getLiveJoinSeamCleaner|getLiveSplitRebalancer)\s*\(/,
		declared: { 'src/lib/tree-operations/node-ops.ts': 'the one reader of both slots' },
		reason: 'a second reader of the rewrite slots is a second opinion on what a join cleans',
		hits: ['getLiveJoinSeamCleaner()?.(join)'],
		misses: ['// getLiveSplitRebalancer() answers']
	},
	{
		id: 'G4.33 the files naming preDelete are the declared ones',
		matches: /(?<![\w.'"])preDelete\b/,
		declared: PRE_DELETE_NAMERS,
		reason:
			'naming the range at all is the tripwire: an alias, a bracket index and a helper forward all still spell it once',
		hits: [
			'raw.slice(0, preDelete.start) + raw.slice(preDelete.end)',
			'const { start, end } = preDelete;',
			'const pd = preDelete; use(pd.start);',
			"const s = preDelete['start'];",
			'const cut = applyPreDelete(node, display, preDelete, offset, seam);'
		],
		misses: ['// preDelete is the range the paste deletes first', 'const myPreDelete = ranges;']
	},
	{
		id: 'G4.12 exactly the declared files intercept a plain destructive key under blocks/text',
		population: (file) => file.relPath.startsWith(TEXT_BLOCK_DIR),
		matches: (file) => DESTRUCTIVE_KEY_RE.test(file.code) && PREVENT_DEFAULT_RE.test(file.code),
		declared: EDGE_INTERCEPTORS,
		reason:
			'a plain Backspace/Delete preventDefault handler under blocks/text routes through the edge-policy dispatch, or is the selected-widget handler',
		hits: [
			at(`${TEXT_BLOCK_DIR}rogue-keys.ts`, "if (e.key === 'Backspace') { e.preventDefault(); }"),
			at(`${TEXT_BLOCK_DIR}rogue-keys.ts`, "if (e.key === 'Delete') e.preventDefault();"),
			at(
				`${TEXT_BLOCK_DIR}rogue-keys.ts`,
				"if (e.key === 'Backspace') { e.preventDefault(); range.deleteContents(); }"
			)
		],
		misses: [
			at(`${TEXT_BLOCK_DIR}x.ts`, "if (e.key === 'ArrowLeft') e.preventDefault();"),
			at(`${TEXT_BLOCK_DIR}x.ts`, "const label = e.key === 'Backspace' ? 'del' : 'x';"),
			"if (e.key === 'Backspace') { e.preventDefault(); }"
		]
	}
];

// ── The obligations on declared files ────────────────────────────────────────

const OBLIGATIONS: FileRule[] = [
	{
		id: 'G4.21 the properties popover compares the bytes a commit would write, not GFM',
		population: (file) => file.relPath === IMAGE_POPOVER,
		matches: (file) => !/\bbuildBytes\s*\(/.test(file.code),
		reason: 'the popover takes the byte writer’s answer as a prop and compares against it',
		reaches: [IMAGE_POPOVER],
		hits: [at(IMAGE_POPOVER, 'const same = buildImageSourceBytes(fields) === raw;')],
		misses: [at(IMAGE_POPOVER, 'const same = buildBytes(fields) === raw;')]
	},
	{
		id: 'G4.11 each read site still carries the handoff that reaches a declared route',
		population: inKeys(readSiteRoles),
		matches: (file) => !file.code.includes(READ_SITE_ROUTES[file.relPath].handoff),
		reason: 'a read site that lost its handoff reads external text into nothing the transforms see',
		reaches: keys(readSiteRoles),
		hits: [at('src/lib/components/menu/clipboard-actions.ts', 'navigator.clipboard.readText();')],
		misses: [
			at(
				'src/lib/components/menu/clipboard-actions.ts',
				'navigator.clipboard.readText(); pasteTextInto(el, text);'
			)
		]
	},
	{
		id: 'G4.45 every declared caller of a bare primitive reaches a settle',
		population: inKeys(BARE_PRIMITIVE_CALLERS),
		matches: (file) => !REACHES_SETTLE.test(file.code),
		reason:
			'a bare split, merge or delete does not settle its own window: call it inside a commit mutate, or settle through spliceChildrenSettled',
		reaches: keys(BARE_PRIMITIVE_CALLERS),
		hits: [
			at('src/lib/editor-actions/list-context.ts', '// commitStructural settles the window'),
			at('src/lib/editor-actions/list-context.ts', 'performSplit(p, i, 0);')
		],
		misses: [
			at('src/lib/editor-actions/list-context.ts', 'await scope.commit({ mutate: (view) => {} });'),
			at('src/lib/editor-actions/list-context.ts', 'await deps.controller.commitMultiScope({});'),
			at('src/lib/editor-actions/list-context.ts', 'spliceChildrenSettled(parent, at, 1, [node]);')
		]
	},
	{
		id: 'G4.12 each declared interceptor routes through updateBlockContent',
		population: inKeys(EDGE_INTERCEPTORS),
		matches: (file) => !/\bupdateBlockContent\s*\(/.test(file.code),
		reason: 'a caret-edge interceptor commits through the CST, never native mutation',
		reaches: keys(EDGE_INTERCEPTORS),
		hits: [at(`${TEXT_BLOCK_DIR}edge-policy-dispatch.ts`, 'range.deleteContents();')],
		misses: [
			at(
				`${TEXT_BLOCK_DIR}edge-policy-dispatch.ts`,
				'deps.blockEdit.updateBlockContent(index, raw, a, b);'
			)
		]
	}
];

const sources = collectEditorSources();
describeManifests(MANIFESTS, sources);
describeFileRules(OBLIGATIONS, sources);
