/**
 * Every live-mode byte rewrite answers to the same oracle and the same seam. Five modules build
 * candidate bytes for a mode that paints no delimiter, and each is only sound because it asks the
 * RENDER PATH what the reader sees rather than walking the parse itself — the walk that once
 * counted an angle autolink's brackets as content, and the selector that once counted a resolved
 * reference's label. The joins add a second rule: they all cross `cleanJoinedRaw`, the one reader
 * of the registered cleaner, so a new destructive path cannot quietly write its own concatenation.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments, type SourceFile } from './scan-source';

/** The live byte-rewrite modules, by set equality: a sixth one is a decision, not a drift. */
const REWRITE_MODULES = [
	'src/lib/components/blocks/text/construct-edge-delete.ts',
	'src/lib/components/blocks/text/link-source-bytes.ts',
	'src/lib/components/blocks/text/live-join-seam.ts',
	'src/lib/components/blocks/text/live-split-rebalance.ts',
	'src/lib/components/blocks/text/pending-mark-insert.ts'
];

/** The one home for "what the reader sees", the module DECLARING the slots, and their one reader. */
const ORACLE_HOME = 'src/lib/core/inline-render.ts';
const SLOT_HOME = 'src/lib/schema/inline-construct-policy.ts';
const SLOT_READER = 'src/lib/tree-operations/node-ops.ts';

/**
 * The joins that do NOT cross `cleanJoinedRaw`, each stated rather than hidden. A paste over a
 * single-block selection deletes through the paste surfaces' own `preDelete`, and there are THREE
 * of them, none carrying a mode. Threading the seam through `PasteDeps` is its own task; until
 * then a live paste over a construct edge writes the literal join — sound, and able to surface a
 * delimiter the cross-block paste would have dropped.
 */
const JOIN_OUTSIDE_THE_SEAM: Record<string, string> = {
	'src/lib/tree-operations/paste/hooks.ts':
		'the default inline and structural hooks — every prose leaf without a bespoke surface',
	'src/lib/components/blocks/table/table-cell-paste.ts':
		'the table cell surface, which escapes its own spliced raw and so cannot share the leaf splice',
	'src/lib/components/blocks/code/code-paste-surface.ts':
		'the fenced-code surface, whose body has no inline constructs for a seam to clean anyway'
};

const namesRenderedText = (file: SourceFile): boolean =>
	/(?<![\w.])renderedText\s*\(/.test(stripComments(file.text));

const readsSlot = (file: SourceFile): boolean =>
	file.relPath !== SLOT_HOME &&
	/(?<![\w.])(getLiveJoinSeamCleaner|getLiveSplitRebalancer)\s*\(/.test(stripComments(file.text));

/** A private CODE answer to "which spans does a marker-hiding mode drop", which only the render
 *  path may hold. A component's own `<style>` block names the same classes to PAINT them, a
 *  different question G4.30's manifest already holds, so `.svelte` files sit this arm out. */
const stripsMarkerSpans = (file: SourceFile): boolean =>
	!file.relPath.endsWith('.svelte') &&
	/['"][^'"]*\.md-(marker|ref-label)/.test(stripComments(file.text));

/** A surface that reads a pre-delete range's endpoints is splicing around them — the join shape
 *  that skipped the seam. Forwarding the object is not: it decides no bytes. */
const readsPreDeleteEndpoints = (file: SourceFile): boolean =>
	/preDelete\??\.(start|end)/.test(stripComments(file.text));

describe('live-rewrite verification source-scan', () => {
	const sources = collectEditorSources();
	const byPath = (path: string) => sources.find((file) => file.relPath === path);

	it('every declared rewrite module is on disk and reachable by the scan', () => {
		expect(REWRITE_MODULES.filter((path) => byPath(path) === undefined)).toEqual([]);
	});

	it('every module naming the render-path oracle is one of the declared rewrites', () => {
		const namers = sources.filter(namesRenderedText).map((file) => file.relPath);
		expect(namers.sort()).toEqual([ORACLE_HOME, ...REWRITE_MODULES].sort());
	});

	it('each declared rewrite verifies through the oracle rather than its own walk', () => {
		expect(REWRITE_MODULES.filter((path) => !namesRenderedText(byPath(path)!))).toEqual([]);
	});

	it('only the render path decides which spans a marker-hiding mode drops', () => {
		const derivers = sources.filter(stripsMarkerSpans).map((file) => file.relPath);
		expect(derivers).toEqual([ORACLE_HOME]);
	});

	it('the registered seam slots have exactly one reader', () => {
		expect(sources.filter(readsSlot).map((file) => file.relPath)).toEqual([SLOT_READER]);
	});

	it('the joins outside the seam are the declared ones', () => {
		// Reading the range's ENDPOINTS is what a surface does to splice around them; a caller that
		// only forwards the object (`preDelete: { start: sel.start … }`) is not deciding bytes. Set
		// equality, so a fourth surface in any splice style is a decision rather than a drift.
		const splicers = sources.filter(readsPreDeleteEndpoints).map((file) => file.relPath);
		expect(splicers.sort()).toEqual(Object.keys(JOIN_OUTSIDE_THE_SEAM).sort());
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('the oracle matcher sees a call and skips a mention in prose', () => {
		expect(/(?<![\w.])renderedText\s*\(/.test('const v = renderedText(nodes, raw);')).toBe(true);
		expect(
			/(?<![\w.])renderedText\s*\(/.test(stripComments('// renderedText(x) is the door'))
		).toBe(false);
	});

	it('the preDelete matcher separates a splice from a forwarded range', () => {
		const probe = (text: string) => readsPreDeleteEndpoints({ relPath: 'x', text, code: '' });
		expect(probe('raw.slice(0, preDelete.start) + raw.slice(preDelete.end)')).toBe(true);
		expect(probe('const start = preDelete?.start ?? offset;')).toBe(true);
		expect(probe('{ preDelete: sel.start !== sel.end ? { start: sel.start } : undefined }')).toBe(
			false
		);
	});

	it('the span matcher sees a private strip of either class', () => {
		const probe = (text: string) => stripsMarkerSpans({ relPath: 'x', text, code: '' });
		expect(probe("el.querySelectorAll('.md-marker')")).toBe(true);
		expect(probe("const SEL = '.md-ref-label, b';")).toBe(true);
		expect(probe("el.querySelectorAll('.block')")).toBe(false);
	});
});
