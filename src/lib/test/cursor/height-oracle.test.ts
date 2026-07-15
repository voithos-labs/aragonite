import { describe, it, expect } from 'vitest';
import { createHeightOracle } from '../../cursor/height-oracle';
import { getPluginMetadata, setPluginMetadata, type CstNode } from '../../core/nodes';
import { declarePluginKind } from '../../schema/plugin-kind';
import { registerBlockKind } from '../../schema/block-kind-descriptor';
import { testClosure } from '$lib/test/support/closure';

const opts = {
	lineHeight: 24,
	codeLineHeight: 20,
	avgCharWidth: 8,
	blockChrome: 16,
	imageBlockMinHeight: 200
};

function para(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

describe('createHeightOracle', () => {
	it('estimates a short paragraph as one line plus chrome', () => {
		const o = createHeightOracle(opts);
		// width 800 / avgCharWidth 8 = 100 chars/line; "hello" wraps to 1 line.
		expect(o.estimate(para('hello'), 800)).toBe(24 + 16);
	});

	it('estimates a long paragraph as multiple wrapped lines', () => {
		const o = createHeightOracle(opts);
		// 250 chars / 100 per line = 3 lines.
		expect(o.estimate(para('x'.repeat(250)), 800)).toBe(24 * 3 + 16);
	});

	it('estimates fenced code by newline count, not wrap', () => {
		const o = createHeightOracle(opts);
		const code: CstNode = { kind: 'fencedCode', leadingTrivia: '', raw: '```\na\nb\n```\n' };
		// 4 source lines at codeLineHeight + chrome.
		expect(o.estimate(code, 800)).toBe(20 * 4 + 16);
	});

	it('measured height supersedes the estimate; height() prefers it', () => {
		const o = createHeightOracle(opts);
		const node = para('hello');
		o.recordMeasured('id-1', 99);
		expect(o.measured('id-1')).toBe(99);
		expect(o.height('id-1', node, 800)).toBe(99);
		expect(o.height('id-2', node, 800)).toBe(24 + 16); // no measurement -> estimate
	});

	it('invalidateWidth clears measured heights (wrap depends on width)', () => {
		const o = createHeightOracle(opts);
		o.recordMeasured('id-1', 99);
		o.invalidateWidth();
		expect(o.measured('id-1')).toBeUndefined();
	});

	// table/tableRow are the only arm combining sourceLines with the prose
	// lineHeight — a refactor folding it into the default (wrapped) arm ships
	// silently without this guard.
	it('estimates table and tableRow by source-line count at prose line height', () => {
		const o = createHeightOracle(opts);
		const table: CstNode = { kind: 'table', leadingTrivia: '', raw: 'a|b\n-|-\nc|d\n' };
		expect(o.estimate(table, 800)).toBe(24 * 3 + 16);
		const row: CstNode = { kind: 'tableRow', leadingTrivia: '', raw: 'a|b\n' };
		expect(o.estimate(row, 800)).toBe(24 * 1 + 16);
	});

	// Containers (blockquote/list/listItem) use a child-count-aware arm: at least
	// one line + chrome per child, and at least the blob-wrap of the materialized
	// raw. The prior blob-only fall-through ignored every newline and per-child
	// chrome, undercounting a stacked container several-fold.
	it('estimates a child-less container by its blob-wrap (no children term)', () => {
		const o = createHeightOracle(opts);
		const quote: CstNode = { kind: 'blockquote', leadingTrivia: '', raw: 'x'.repeat(250) };
		// blob-wrap (3 lines) dominates the single-child fallback term.
		expect(o.estimate(quote, 800)).toBe(24 * 3 + 16);
	});

	it('scales a container estimate with its child count (O(1), not a subtree walk)', () => {
		const o = createHeightOracle(opts);
		const raw = '- a\n- b\n- c\n- d\n- e\n'; // short rows: blob-wrap is 1 line
		const few: CstNode = { kind: 'list', leadingTrivia: '', raw, children: [{}, {}] as CstNode[] };
		const many: CstNode = {
			kind: 'list',
			leadingTrivia: '',
			raw,
			children: [{}, {}, {}, {}, {}] as CstNode[]
		};
		// Identical raw, more children => taller. The old blob-only estimate gave
		// both the same (~1 line) height — the central undercount this arm fixes.
		expect(o.estimate(many, 800)).toBeGreaterThan(o.estimate(few, 800));
		expect(o.estimate(many, 800)).toBe(5 * (24 + 16)); // 5 children, >= one line + chrome each
	});

	// The plugin-contract unknown-kind rule: a kind with no per-kind arm must fall
	// through to the default wrapped (prose) estimate, never crash the measure path.
	it('estimates an unknown plugin kind via the default wrapped arm', () => {
		const o = createHeightOracle(opts);
		const plugin: CstNode = {
			kind: declarePluginKind('oracle-unknown-kind'),
			leadingTrivia: '',
			raw: 'x'.repeat(250)
		};
		expect(o.estimate(plugin, 800)).toBe(24 * 3 + 16);
	});

	it('counts source lines with the trailing-newline correction', () => {
		const o = createHeightOracle(opts);
		const empty: CstNode = { kind: 'indentedCode', leadingTrivia: '', raw: '' };
		expect(o.estimate(empty, 800)).toBe(20 * 1 + 16); // empty -> floored at 1 line
		const noTrailing: CstNode = { kind: 'indentedCode', leadingTrivia: '', raw: 'a\nb' };
		expect(o.estimate(noTrailing, 800)).toBe(20 * 2 + 16); // 2 lines, no phantom trailing line
	});

	it('estimates a thematic break as a constant, independent of raw and width', () => {
		const o = createHeightOracle(opts);
		const hr: CstNode = { kind: 'thematicBreak', leadingTrivia: '', raw: '---\n' };
		expect(o.estimate(hr, 800)).toBe(24 + 16);
		expect(o.estimate(hr, 200)).toBe(24 + 16);
	});

	// A rendered image is far taller than its `![alt](url)` source, so the char-based
	// estimate would seed an image-only paragraph at ~1 line and a screenful of images
	// undercounts to near-zero. The floor keeps the estimate honest enough for
	// activation/spacers. Without it the estimate collapses to one line + chrome.
	it('floors an image-bearing paragraph at imageBlockMinHeight', () => {
		const o = createHeightOracle(opts);
		const img: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: '![A photo|400](pic.png)' };
		const oneLine = 24 + 16;
		expect(o.estimate(img, 800)).toBe(200); // floored, not the ~40px char estimate
		expect(o.estimate(img, 800)).toBeGreaterThan(oneLine);
	});

	it('keeps the prose estimate when an image paragraph already exceeds the floor', () => {
		const o = createHeightOracle(opts);
		// Long caption around the image wraps to > 200px on its own; floor doesn't apply.
		const wide: CstNode = {
			kind: 'paragraph',
			leadingTrivia: '',
			raw: '![x](pic.png) ' + 'word '.repeat(300)
		};
		expect(o.estimate(wide, 800)).toBeGreaterThan(200);
	});

	it('does not floor a plain paragraph without an image', () => {
		const o = createHeightOracle(opts);
		expect(o.estimate(para('hello'), 800)).toBe(24 + 16); // unfloored short prose
	});

	// Reference-style images (`![alt][ref]`) have no `(`; the prior detector
	// required one and missed them, estimating a wall of reference images at ~1
	// line — the worst single offender in the demo content.
	it('floors a reference-style image paragraph (the `(`-less form)', () => {
		const o = createHeightOracle(opts);
		const ref: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: '![a screenshot][shot]' };
		expect(o.estimate(ref, 800)).toBe(200);
	});

	it('sums the floor across multiple images in one paragraph', () => {
		const o = createHeightOracle(opts);
		const three: CstNode = {
			kind: 'paragraph',
			leadingTrivia: '',
			raw: '![one][a] ![two][b] ![three][c]'
		};
		expect(o.estimate(three, 800)).toBe(3 * 200); // image count, not a single floor
	});

	it('uses an explicit `|WxH` height hint over the floor; width-only falls back', () => {
		const o = createHeightOracle(opts);
		const tall: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: '![a|100x500](pic.png)' };
		expect(o.estimate(tall, 800)).toBe(500); // the hint's H, above the 200 floor
		const wideOnly: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: '![a|400](pic.png)' };
		expect(o.estimate(wideOnly, 800)).toBe(200); // height unknown from width alone -> floor
	});

	it('estimates a wide table by cell-wrap (blob), above its source-line count', () => {
		const o = createHeightOracle(opts);
		// Two source lines, but one very long row that wraps far past two lines.
		const wide: CstNode = {
			kind: 'table',
			leadingTrivia: '',
			raw: '| ' + 'x'.repeat(2000) + ' |\n| --- |\n'
		};
		expect(o.estimate(wide, 800)).toBeGreaterThan(2 * 24 + 16); // not just source-line count
	});

	// A collapsed container mounts only its chrome row; estimating from its full
	// `raw` (which still carries the hidden body) over-counts it several-fold. The
	// oracle reads the declared collapse probe and returns one chrome row instead —
	// the tight estimate. Open, it falls through to the normal full-raw arm.
	it('estimates a collapsed container at one chrome row, open at its full raw', () => {
		const o = createHeightOracle(opts);
		const summary = declarePluginKind('oracle-collapsible-chrome');
		const collapsible = declarePluginKind('oracle-collapsible');
		registerBlockKind(collapsible, {
			mergeRole: 'container',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			// The oracle only estimates, so an inert strip contract + noop rebuild
			// satisfy the group's required pairing.
			container: {
				contract: 'strip',
				rebuildRaw: () => {},
				reservedChrome: {
					kind: summary,
					isCollapsed: (n) => !getPluginMetadata<{ open: boolean }>(n)?.open
				}
			}
		});

		const bigBody = 'x'.repeat(2000); // full-raw estimate is 20 wrapped lines at width 800
		const collapsed: CstNode = { kind: collapsible, leadingTrivia: '', raw: bigBody };
		setPluginMetadata(collapsed, { open: false });
		expect(o.estimate(collapsed, 800)).toBe(24 + 16); // one chrome row, body ignored

		const open: CstNode = { kind: collapsible, leadingTrivia: '', raw: bigBody };
		setPluginMetadata(open, { open: true });
		expect(o.estimate(open, 800)).toBe(20 * 24 + 16); // unchanged full-raw wrapped estimate
	});

	// A descriptor's own O(1) estimate supersedes the char-based default arm (a
	// rendered artifact — diagram, embed — is far taller than its source text). The
	// oracle still adds block chrome and a measured height still supersedes.
	it('a descriptor estimateHeight wins over the default arm, plus block chrome', () => {
		const o = createHeightOracle(opts);
		const estimated = declarePluginKind('oracle-estimate-height');
		registerBlockKind(estimated, {
			mergeRole: 'not-mergeable',
			editable: false,
			supportsInline: false,
			closure: testClosure,
			estimateHeight: () => 320
		});
		const node: CstNode = { kind: estimated, leadingTrivia: '', raw: 'x\n' };
		expect(o.estimate(node, 600)).toBe(320 + opts.blockChrome);
	});

	// Ordering guard: the collapse arm precedes the estimateHeight arm, so a
	// collapsed container mounts one chrome row and its estimateHeight is ignored.
	// Swapping the arms would return 320 + chrome here.
	it('a collapsed container ignores estimateHeight (one chrome row wins)', () => {
		const o = createHeightOracle(opts);
		const summary = declarePluginKind('oracle-estimate-chrome');
		const collapsible = declarePluginKind('oracle-estimate-collapsed');
		registerBlockKind(collapsible, {
			mergeRole: 'container',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			estimateHeight: () => 320,
			container: {
				contract: 'strip',
				rebuildRaw: () => {},
				reservedChrome: { kind: summary, isCollapsed: () => true }
			}
		});
		const node: CstNode = { kind: collapsible, leadingTrivia: '', raw: 'x'.repeat(2000) };
		expect(o.estimate(node, 600)).toBe(opts.lineHeight + opts.blockChrome);
	});

	it('clear() empties the measured cache', () => {
		const o = createHeightOracle(opts);
		o.recordMeasured('id-1', 99);
		o.clear();
		expect(o.measured('id-1')).toBeUndefined();
	});
});
