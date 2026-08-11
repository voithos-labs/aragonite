/**
 * A kind's own raw-write rule (`normalizeRawWrite`) reaches its bytes through two readers —
 * `writeOwnRaw` in place, `normalizeOwnRaw` for a sink that reparses the result — and every
 * sink writing a leaf's raw without the kind's surface calls one (issues #45, #55). The site
 * lists make sink N+1 a decision; the sanctioned-writes arm makes a sink that names neither
 * reader one too.
 */

import { describe, it, expect } from 'vitest';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { collectEditorSources, rawAssignments, stripComments } from './scan-source';

const SINK = 'src/lib/tree-operations/node-ops.ts';

/** Every file naming the capability in code, and why. */
const CAPABILITY_SITES: Record<string, string> = {
	'src/lib/schema/block-kind-descriptor.ts': 'the field declaration',
	'src/lib/schema/built-in-descriptors.ts': 'tableCell and fencedCode declare it',
	[SINK]: 'the reader dispatches it'
};

/** Every sink that writes a leaf's raw in place and owes the kind's rule. */
const READER_SITES: Record<string, string> = {
	[SINK]: 'the reader itself, plus the context-dependent-kind write',
	'src/lib/editor-actions/search-replace.ts': 'substitutes into a private clone',
	'src/lib/selection/range-delete.ts': 'the same-block merge writes raw with no reparse',
	'src/lib/selection/cross-block/type-replace.ts': 'the degraded arm splices raw',
	'src/lib/tree-operations/paste/container-match.ts': 'splices clipboard text into the target leaf',
	'src/lib/editor-actions/inline-range-commit.ts':
		'the anchored inline editors splice a construct range with no reparse'
};

/**
 * Every sink that REPLACES the leaf with a reparse of the bytes it built. The reparse re-derives
 * metadata, so the rule runs against the OLD node or the structure it would restore is gone.
 */
const PRE_REPARSE_SITES: Record<string, string> = {
	[SINK]: 'the reader itself',
	'src/lib/selection/range-delete.ts': 'the cross-block merge normalizes the end slice',
	'src/lib/selection/range-delete-ceremony.ts':
		'the endpoint-survivor reparse, shared by all three branches',
	'src/lib/editor-actions/inline-range-commit.ts':
		'reads the rule ahead of the write to decide whether the splice changes a byte at all'
};

/**
 * A branch inherits the rule by routing through that shared endpoint reparse rather than naming
 * a reader, which the per-file scan above cannot see. Rebuilding the reparse locally drops the
 * rule silently, so the inheritance is pinned on the helper's own name.
 */
const PRE_REPARSE_INHERITORS: Record<string, string> = {
	'src/lib/selection/range-delete-ceremony.ts': 'defines it',
	'src/lib/selection/range-delete.ts': 'the generic merge installs its survivor through it',
	'src/lib/selection/range-delete-chrome.ts': 'both endpoints of a wall range',
	'src/lib/selection/range-delete-table.ts':
		'both prose endpoints of a table range route through it'
};

/** The fence rule has one implementation, shared by the display funnel and the byte sink. */
const FENCE_HOME = 'src/lib/schema/fenced-code-raw.ts';
const FENCE_READERS: Record<string, string> = {
	[FENCE_HOME]: 'the implementation',
	'src/lib/components/blocks/code/CodeBlock.svelte': 'the display-commit funnel',
	'src/lib/components/blocks/code/code-paste.ts': 'the paste surface'
};

const CAPABILITY = /\bnormalizeRawWrite\b/;
const READER = /\bwriteOwnRaw\b/;
const PRE_REPARSE_READER = /\bnormalizeOwnRaw\b/;
const PRE_REPARSE_HELPER = /\breparseTruncatedEndpoint\b/;

function namesInCode(sources: { relPath: string; code: string }[], re: RegExp): string[] {
	return sources
		.filter((f) => re.test(f.code))
		.map((f) => f.relPath)
		.sort();
}

describe('the kind’s own raw-write rule runs at every byte sink', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it.each(['tableCell', 'fencedCode'] as const)('%s declares the capability', (kind) => {
		expect(typeof getBlockKindDescriptor(kind).normalizeRawWrite).toBe('function');
	});

	it('the reader lives at the sink and dispatches whatever the kind declared', () => {
		const sink = sources.find((f) => f.relPath === SINK);
		expect(sink, `${SINK} not found`).toBeDefined();
		expect(CAPABILITY.test(sink!.code), 'the reader stopped dispatching the capability').toBe(true);
	});

	it('exactly the documented sites name the capability', () => {
		expect(namesInCode(sources, CAPABILITY)).toEqual(Object.keys(CAPABILITY_SITES).sort());
	});

	// Fails when a sink is wired in or unwired, making door N+1 an explicit decision. A bare
	// `.raw =` write names no reader; the sanctioned-writes arm below is what catches those.
	it('exactly the documented sinks call the reader', () => {
		expect(namesInCode(sources, READER)).toEqual(Object.keys(READER_SITES).sort());
	});

	it('exactly the documented sinks normalize ahead of their own reparse', () => {
		expect(namesInCode(sources, PRE_REPARSE_READER)).toEqual(Object.keys(PRE_REPARSE_SITES).sort());
	});

	it('exactly the documented branches inherit the rule through the shared reparse', () => {
		expect(namesInCode(sources, PRE_REPARSE_HELPER)).toEqual(
			Object.keys(PRE_REPARSE_INHERITORS).sort()
		);
	});
});

// ── The bare write: a byte sink that names neither reader ────────────────────

/**
 * Files holding a `<node>.raw =` write that consults no kind rule, each with the count it is
 * sanctioned for — a file-granular entry would let write N+1 in unnoticed. A sanctioned write
 * either IS a kind re-emitting its own bytes, or cannot reach a kind that declares a rule.
 */
const BARE_RAW_WRITE_ALLOWLIST: Record<string, { count: number; why: string }> = {
	[SINK]: {
		count: 10,
		why: 'the sanctioned writer itself, plus the reparse funnel: every other write here is re-read from a parse, restores bytes the slot already held, or re-attaches the blank line that parse peeled off (GH #97). Both deep-leaf merge arms land bytes that already crossed `normalizeOwnRaw` and a fragment reparse (GH #54)'
	},
	'src/lib/schema/container-rebuilders.ts': {
		count: 5,
		why: 'the built-in containers re-emit their own bytes from their children (G4.20 arm 3 reads the same writes)'
	},
	'src/lib/core/directive/kinds.ts': { count: 1, why: "the directive container's own rebuildRaw" },
	'src/lib/editor-actions/plugin/directive-container.ts': {
		count: 1,
		why: 'the titled-directive rebuildRaw factory'
	},
	'src/lib/plugins/admonitions/github-alert-kind.ts': {
		count: 2,
		why: "the alert's own rebuildRaw, empty-body and filled arms"
	},
	'src/lib/plugins/details/details-kind.ts': {
		count: 1,
		why: "the details container's rebuildRaw"
	},
	'src/lib/plugins/footnotes/footnote-definition.ts': {
		count: 1,
		why: "the definition's own rebuildRaw"
	},
	'src/lib/plugins/mermaid/mermaid-kind.ts': {
		count: 1,
		why: 'the mermaid leaf re-emits its fence from its own metadata — for its bytes, the kind IS the rule'
	},
	'examples/consumer/src/routes/dev-guard/dev-probe.ts': {
		count: 1,
		why: "the reference plugin's own rebuildRaw"
	},
	'src/lib/editor-actions/commit/undo-controller.ts': {
		count: 1,
		why: 'the rollback restores raws the tree already held; nothing new is minted'
	},
	'src/lib/selection/range-delete-ceremony.ts': {
		count: 2,
		why: 'the chrome-clear, a reserved-chrome slot no leaf kind declaring a rule can occupy; and the endpoint reparse re-attaching the blank line that parse peeled off (GH #97)'
	},
	'src/lib/selection/range-delete-chrome.ts': {
		count: 2,
		why: "both endpoints' chrome-clear arms, same reserved slot"
	},
	'src/lib/selection/range-delete-table.ts': {
		count: 4,
		why: 'two chrome-clear arms plus two cell clears; a cleared cell is empty, which `tableCell`’s own rule already returns unchanged'
	},
	'src/lib/tree-operations/list/reconcile-task.ts': {
		count: 2,
		why: "moves the task marker between the item's metadata and its first paragraph, kind-guarded to paragraph"
	},
	'src/lib/tree-operations/list/unwrap-merge.ts': {
		count: 1,
		why: 'the list-item merge target, which throws unless it is a paragraph'
	},
	'src/lib/tree-operations/list/terminator.ts': {
		count: 1,
		why: "appends the list's own line ending to the deepest leaf; an ending terminates a line rather than restructuring one"
	},
	'src/lib/tree-operations/paste/container-match.ts': {
		count: 1,
		why: "the last pasted item's leaf, gated to a paragraph by `hasSingleParagraphChild` — the merged target beside it routes through the reader, so the pair is asymmetric"
	},
	'src/lib/testing/container-conformance.ts': {
		count: 3,
		why: "the published kit's own fixture bytes, written into a throwaway parse"
	}
};

const BARE_WRITE_RULE =
	'a `<node>.raw =` write reaches a leaf’s bytes with no kind rule in front of it — the shape ' +
	'issue #45 shipped through. Route it through `writeOwnRaw` (in place) or `normalizeOwnRaw` ' +
	'(ahead of your own reparse), or add the file to BARE_RAW_WRITE_ALLOWLIST with its count and ' +
	'the reason its writes cannot reach a kind that declares one';

describe('every bare raw write is sanctioned', () => {
	const writes = rawAssignments(collectEditorSources());

	it('no file outside the sanctioned set writes a leaf’s raw directly', () => {
		const unsanctioned = writes
			.filter((w) => !(w.relPath in BARE_RAW_WRITE_ALLOWLIST))
			.map((w) => w.relPath);
		expect([...new Set(unsanctioned)], BARE_WRITE_RULE).toEqual([]);
	});

	it('each sanctioned file holds exactly the writes its entry accounts for', () => {
		for (const [relPath, entry] of Object.entries(BARE_RAW_WRITE_ALLOWLIST)) {
			const found = writes.filter((w) => w.relPath === relPath).length;
			expect(
				found,
				`${relPath} holds ${found} bare raw writes, sanctioned for ${entry.count} — ${entry.why}`
			).toBe(entry.count);
		}
	});
});

describe('the fence rule has one implementation', () => {
	const sources = collectEditorSources();

	it('exactly the documented readers name the reconciliation', () => {
		expect(namesInCode(sources, /\breconcileFenceWrite\b/)).toEqual(
			Object.keys(FENCE_READERS).sort()
		);
	});

	it('the escalation primitive is named only by the grammar leaf and the rule', () => {
		expect(namesInCode(sources, /\bescalatedFenceLength\b/)).toEqual([
			'src/lib/core/parsers/fence-syntax.ts',
			FENCE_HOME
		]);
	});

	// The rule reads the block's OWN fence shape, so it must live where a headless sink can
	// reach it: under `components/` it would exist only once the component tree loaded.
	it('the rule home is in schema, importing no component', () => {
		const home = sources.find((f) => f.relPath === FENCE_HOME);
		expect(home, `${FENCE_HOME} not found`).toBeDefined();
		expect(home!.code).not.toMatch(/from\s*['"][^'"]*components/);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('a mention inside a comment cannot satisfy the scan', () => {
		expect(READER.test(stripComments('// calls writeOwnRaw one day\n'))).toBe(false);
		expect(READER.test(stripComments('x = writeOwnRaw(n, r);\n'))).toBe(true);
	});
});
