/**
 * G4.46 — the ancestry rebuild's `folds` sink is a required-nullable capability: a fold splices
 * the PARENT's children array, so only a caller that reconciles that scope's ids/refs may pass
 * one. The type stops an omission; what it cannot stop is caller N+1 answering `null` because
 * reconciling was inconvenient, and a wrong id length is permanent. Hence the site map below —
 * every production call site is enumerated with the stance it takes and why it takes it.
 */

import { describe, it, expect } from 'vitest';
import { callArguments, callsTo, collectEditorSources, stripComments } from './scan-source';

const SEAMS = ['rebuildUnsharedChain', 'rebuildUnsharedAncestry'] as const;

/** `(root, chain, sharing, folds, grammar)` — the sink is the fourth argument of both seams. */
const FOLDS_ARGUMENT = 3;

interface SiteStance {
	/** Calls answering the literal `null`. */
	declines: number;
	/** Calls passing a sink, which is the claim "I can reconcile a parent-scope splice". */
	sinks: number;
	why: string;
}

const SITES: Record<string, SiteStance> = {
	'src/lib/editor-actions/commit/undo-controller.ts': {
		declines: 0,
		sinks: 1,
		why: 'the multi-scope ceremony owns the doc-level ids/refs and every prepared scope’s state, so it reconciles and publishes the fold’s unwind'
	},
	'src/lib/editor-actions/container-edit.ts': {
		declines: 0,
		sinks: 1,
		why: 'the routine-typing spine; it publishes no descriptor of its own, so it reconciles the splice directly'
	},
	'src/lib/tree-operations/unshare.ts': {
		declines: 0,
		sinks: 1,
		why: 'the ancestry wrapper threads its own parameter through, so its caller states a stance rather than inheriting one'
	},
	'src/lib/editor-actions/block-edit-core.ts': {
		declines: 1,
		sinks: 0,
		why: 'a decision, not a constraint: the rebuild root IS the scope whose descriptor the ceremony publishes, so a fold there would ride that descriptor. Declining because a metadata write that changes what a container interrupts has no producer'
	},
	'src/lib/selection/cross-block/format-range.ts': {
		declines: 1,
		sinks: 0,
		why: 'a byte write inside the content range: no opener or closer line moves, so no fold a parent scope would have to reconcile can be produced'
	},
	'src/lib/selection/cross-block/type-replace.ts': {
		declines: 1,
		sinks: 0,
		why: 'the degraded splice arm, which already warns; its chain is built from a leaf path strictly BELOW the commit scope, so the ceremony’s own re-walk does not reach those levels'
	},
	'src/lib/selection/range-delete.ts': {
		declines: 3,
		sinks: 0,
		why: 'the cross-block delete family: byte-correctness passes inside a ceremony that owns the registers elsewhere and splices at the LCA itself. Their chains can run deeper than the ceremony’s scope, which is a recorded residual rather than a reconciliation'
	},
	'src/lib/selection/range-delete-ceremony.ts': {
		declines: 2,
		sinks: 0,
		why: 'same family — the endpoint-survivor and chrome-clear rebuild passes'
	},
	'src/lib/selection/range-delete-chrome.ts': {
		declines: 2,
		sinks: 0,
		why: 'same family — both endpoints of a wall range'
	},
	'src/lib/selection/range-delete-table.ts': {
		declines: 7,
		sinks: 0,
		why: 'same family — every table-range endpoint and survivor pass'
	},
	'src/lib/tree-operations/paste/container-match.ts': {
		declines: 2,
		sinks: 0,
		why: 'the merged leaf sits below the commit scope, and the deeper levels are listItem/list joins the absorb’s same-kind window test cannot satisfy'
	},
	'src/lib/testing/container-conformance.ts': {
		declines: 1,
		sinks: 0,
		why: 'the published kit owns neither ids nor refs, so there is no parent scope for it to reconcile'
	}
};

const SINK_RULE =
	'an ancestry rebuild answers the `folds` sink at a site this map does not know. Passing a sink ' +
	'is the claim "I can reconcile a parent-scope splice"; `null` is an explicit decline. Add the ' +
	'file to SITES with its counts and the stance it takes, so the next wave reads a decision ' +
	'rather than an accident';

interface SinkCall {
	relPath: string;
	declines: boolean;
}

/** Every seam call in `code`, classified by whether its sink argument is the literal `null`. */
function sinkCalls(relPath: string, rawText: string): SinkCall[] {
	const code = stripComments(rawText);
	return SEAMS.flatMap((seam) =>
		callsTo(code, seam).map((call) => ({
			relPath,
			declines: callArguments(call)[FOLDS_ARGUMENT] === 'null'
		}))
	);
}

describe('ancestry-rebuild fold-sink source-scan', () => {
	const calls = collectEditorSources().flatMap((f) => sinkCalls(f.relPath, f.text));

	it('found the seam call sites to validate', () => {
		expect(new Set(calls.map((c) => c.relPath)).size).toBe(Object.keys(SITES).length);
	});

	it('every caller is enumerated with a stance', () => {
		const unknown = calls.filter((c) => !(c.relPath in SITES)).map((c) => c.relPath);
		expect([...new Set(unknown)], SINK_RULE).toEqual([]);
	});

	it('each enumerated file takes exactly the stance its entry records', () => {
		for (const [relPath, stance] of Object.entries(SITES)) {
			const own = calls.filter((c) => c.relPath === relPath);
			expect(
				{
					declines: own.filter((c) => c.declines).length,
					sinks: own.filter((c) => !c.declines).length
				},
				`${relPath} — ${stance.why}`
			).toEqual({ declines: stance.declines, sinks: stance.sinks });
		}
	});

	// The declining set is a judgement call, so the map is only worth its lines while a reader can
	// see one: a reason too thin to argue with is the shape this scan is meant to stop.
	it('every stance states a reason', () => {
		for (const [relPath, stance] of Object.entries(SITES)) {
			expect(stance.why.length, `${relPath} states no substantive reason`).toBeGreaterThan(40);
		}
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('matcher reads the sink slot, not the last argument', () => {
		expect(
			sinkCalls('synthetic.ts', 'rebuildUnsharedChain(doc, chain, sharing, null, null);')
		).toEqual([{ relPath: 'synthetic.ts', declines: true }]);
		expect(
			sinkCalls('synthetic.ts', 'rebuildUnsharedAncestry(doc, path, sharing, folds, ctx.grammar);')
		).toEqual([{ relPath: 'synthetic.ts', declines: false }]);
	});

	it('matcher ignores the declarations and tokens in comments', () => {
		const decl =
			'export function rebuildUnsharedChain(root, chain, sharing, folds, grammar) {}\n' +
			'// rebuildUnsharedAncestry(doc, path, sharing, null, grammar) would decline';
		expect(sinkCalls('synthetic.ts', decl)).toEqual([]);
	});

	it('matcher survives a nested call in an earlier argument', () => {
		expect(
			sinkCalls('synthetic.ts', 'rebuildUnsharedChain(doc, chainOf(a, b), sharing, null, grammar);')
		).toEqual([{ relPath: 'synthetic.ts', declines: true }]);
	});
});
