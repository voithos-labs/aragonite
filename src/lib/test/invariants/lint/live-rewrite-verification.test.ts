/**
 * Every live-mode byte rewrite answers to the same oracle and the same seam. Most of the modules
 * below build candidate bytes for a mode that paints no delimiter; the edge seat asks which bytes a
 * childless construct shows. Each is only sound because it asks the RENDER PATH what the reader
 * sees rather than walking the parse itself (G4.33). The joins add a second rule: they all cross
 * `cleanJoinedRaw`, the one reader of the registered cleaner, so a new destructive path cannot
 * quietly write its own concatenation.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments, type SourceFile } from './scan-source';

/** The live byte-rewrite modules, by set equality: one more is a decision, not a drift. */
const REWRITE_MODULES = [
	'src/lib/components/blocks/text/construct-edge-delete.ts',
	'src/lib/components/blocks/text/edge-seat.ts',
	'src/lib/components/blocks/text/format-toggle.ts',
	'src/lib/components/blocks/text/link-source-bytes.ts',
	'src/lib/components/blocks/text/live-join-seam.ts',
	'src/lib/components/blocks/text/live-split-rebalance.ts',
	'src/lib/components/blocks/text/pending-mark-insert.ts'
];

/** The one home for "what the reader sees", the module DECLARING the slots, and their one reader. */
const ORACLE_HOME = 'src/lib/core/inline/visibility.ts';
const SLOT_HOME = 'src/lib/schema/inline-construct-policy.ts';
const SLOT_READER = 'src/lib/tree-operations/node-ops.ts';

/**
 * Every file permitted to NAME `preDelete` at all: the contract and door that carry the field,
 * the surfaces that mint a range from their own selection and forward it, the two crossings
 * into `cutRangeFromDisplay` — and the one splicer, stated with its reason. Name-level set
 * equality closes the alias/bracket/helper-forward holes the endpoint-spelling matcher it
 * replaced left open (#114).
 */
const PRE_DELETE_NAMERS: Record<string, string> = {
	'src/lib/tree-operations/paste-surfaces.ts': 'the surface contract declaring the parameter',
	'src/lib/tree-operations/paste/dispatch.ts': 'the request door carrying the field to the hooks',
	'src/lib/tree-operations/paste/hooks.ts': 'the prose crossing into cutRangeFromDisplay',
	'src/lib/components/blocks/table/table-cell-paste.ts':
		'the cell crossing into cutRangeFromDisplay, ahead of the escaping sink',
	'src/lib/components/blocks/text/text-clipboard.ts': 'mints the range from its selection',
	'src/lib/components/blocks/code/CodeBlock.svelte': 'mints the range from its selection',
	'src/lib/components/blocks/table/TableCellBlock.svelte': 'mints the range from its selection',
	'src/lib/components/blocks/code/code-paste-surface.ts':
		'the one splicer: a fenced body has no inline constructs for a seam to clean'
};

/** The oracle's two doors: the reader's text, and the runs it is the concatenation of. */
const ORACLE_CALL = /(?<![\w.])(?:renderedText|visibleRuns)\s*\(/;

const namesOracle = (file: SourceFile): boolean => ORACLE_CALL.test(stripComments(file.text));

const readsSlot = (file: SourceFile): boolean =>
	file.relPath !== SLOT_HOME &&
	/(?<![\w.])(getLiveJoinSeamCleaner|getLiveSplitRebalancer)\s*\(/.test(stripComments(file.text));

/**
 * Every file naming an inline marker family in code, and what it does with it. Only the oracle
 * may answer "which of these spans does a marker-hiding mode drop"; the rest mint the class,
 * identify their own span, or probe it. The spelling is deliberately loose — the CSS form and the
 * `classList` form are the same claim, and requiring the leading dot let the second one through.
 * A component's own `<style>` block names the classes to PAINT them, a different question G4.30's
 * manifest holds, so `.svelte` files sit this arm out.
 */
const MARKER_FAMILY_NAMERS: Record<string, string> = {
	'src/lib/core/inline/visibility.ts': 'the oracle: states the families and drops what hides',
	'src/lib/core/inline-render.ts': 'mints the spans the oracle then reads back',
	'src/lib/cursor/widget-offset.ts':
		'identifies the ambient island, whose contenteditable="false" marker is no family of the rule',
	'src/lib/ambient/ambient-dom.ts': 'mints that same island',
	'src/lib/components/blocks/text/text-render.ts': "mints the block's own prefix span",
	'src/lib/components/blocks/code/code-renderer.ts': 'mints the fence marker spans',
	'src/lib/invariants/marker-css-parity.ts': 'mounts one probe span per family for the DEV probe'
};

const namesMarkerFamily = (file: SourceFile): boolean =>
	!file.relPath.endsWith('.svelte') &&
	/['"][^'"]*md-(marker|ref-label)/.test(stripComments(file.text));

/** Naming the range at all is the tripwire: an alias, a bracket index and a helper forward all
 *  still spell the name once. Comment mentions are out of scope through the shared strip. */
const namesPreDelete = (file: SourceFile): boolean =>
	/(?<![\w.'"])preDelete\b/.test(stripComments(file.text));

describe('live-rewrite verification source-scan', () => {
	const sources = collectEditorSources();
	const byPath = (path: string) => sources.find((file) => file.relPath === path);

	it('every declared rewrite module is on disk and reachable by the scan', () => {
		expect(REWRITE_MODULES.filter((path) => byPath(path) === undefined)).toEqual([]);
	});

	it('every module naming the render-path oracle is one of the declared rewrites', () => {
		const namers = sources.filter(namesOracle).map((file) => file.relPath);
		expect(namers.sort()).toEqual([ORACLE_HOME, ...REWRITE_MODULES].sort());
	});

	it('each declared rewrite verifies through the oracle rather than its own walk', () => {
		expect(REWRITE_MODULES.filter((path) => !namesOracle(byPath(path)!))).toEqual([]);
	});

	it('every file naming an inline marker family is manifested with what it does with it', () => {
		const namers = sources.filter(namesMarkerFamily).map((file) => file.relPath);
		expect(
			namers.sort(),
			'a file started naming marker classes: route the drop question through the oracle, or ' +
				'add it to MARKER_FAMILY_NAMERS saying what it does instead'
		).toEqual(Object.keys(MARKER_FAMILY_NAMERS).sort());
	});

	it('the registered seam slots have exactly one reader', () => {
		expect(sources.filter(readsSlot).map((file) => file.relPath)).toEqual([SLOT_READER]);
	});

	it('the files naming preDelete are the declared ones', () => {
		// Set equality over the NAME, so a new reader is a lint conversation whatever its spelling.
		const namers = sources.filter(namesPreDelete).map((file) => file.relPath);
		expect(namers.sort()).toEqual(Object.keys(PRE_DELETE_NAMERS).sort());
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('the oracle matcher sees either door and skips a mention in prose', () => {
		expect(ORACLE_CALL.test('const v = renderedText(nodes, raw, ctx);')).toBe(true);
		expect(ORACLE_CALL.test('for (const run of visibleRuns(nodes, raw, ctx))')).toBe(true);
		expect(ORACLE_CALL.test(stripComments('// renderedText(x) is the door'))).toBe(false);
	});

	it('the preDelete matcher sees every spelling and skips prose', () => {
		const probe = (text: string) => namesPreDelete({ relPath: 'x', text, code: '' });
		expect(probe('raw.slice(0, preDelete.start) + raw.slice(preDelete.end)')).toBe(true);
		expect(probe('const { start, end } = preDelete;')).toBe(true);
		// The spellings the endpoint matcher could not see (#114).
		expect(probe('const pd = preDelete; use(pd.start);')).toBe(true);
		expect(probe("const s = preDelete['start'];")).toBe(true);
		expect(probe('const cut = applyPreDelete(node, display, preDelete, offset, seam);')).toBe(true);
		expect(probe('// preDelete is the range the paste deletes first')).toBe(false);
		expect(probe('const myPreDelete = ranges;')).toBe(false);
	});

	it('an undeclared file naming preDelete fails the set equality', () => {
		const rogue: SourceFile = {
			relPath: 'src/lib/components/blocks/text/rogue.ts',
			text: 'const pd = preDelete;',
			code: ''
		};
		const namers = [...sources, rogue].filter(namesPreDelete).map((file) => file.relPath);
		expect(namers.sort()).not.toEqual(Object.keys(PRE_DELETE_NAMERS).sort());
	});

	it('the family matcher sees either class in either spelling', () => {
		const probe = (text: string) => namesMarkerFamily({ relPath: 'x', text, code: '' });
		expect(probe("el.querySelectorAll('.md-marker')")).toBe(true);
		expect(probe("const SEL = '.md-ref-label, b';")).toBe(true);
		// The spelling the dot-anchored matcher could not see.
		expect(probe("el.classList.contains('md-marker')")).toBe(true);
		expect(probe("el.querySelectorAll('.block')")).toBe(false);
	});
});
