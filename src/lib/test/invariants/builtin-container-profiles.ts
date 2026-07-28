/**
 * G4.3 conformance profiles for the BUILT-IN container kinds — fixture data for
 * the kit in `$lib/testing/container-conformance`. Kept out of the shipped kit:
 * a plugin author supplies their own profile, and these strings would be dead
 * weight in `aragonite/testing`.
 *
 * The completeness meta-tests in `container-conformance.test.ts` hold this map in
 * lockstep with the descriptor registry, so a new built-in container kind is
 * auto-covered the moment it registers.
 *
 * Grid containers (table/tableRow) re-derive their ENTIRE subtree raw in one
 * `rebuildRaw` (see `rebuildTableRaw` — it rebuilds every row), so the
 * innermost-first ordering invariant doesn't apply; and grid focus is
 * cell-addressed (focusCell rowIdx/colIdx) rather than innerIndex delegation.
 * Those cells are declared BOUNDARY/EXEMPT below — never a silent skip.
 */

import type { BlockKind } from '$lib/core/nodes';
import type { ContainerConformanceProfile } from '$lib/testing';

export const CONTAINER_PROFILES: Partial<Record<BlockKind, ContainerConformanceProfile>> = {
	blockquote: {
		// outer bq > inner bq (local index 1) > [paragraph, paragraph].
		deepNesting: { source: '> top\n>\n> > inner-a\n> >\n> > inner-b\n', leafPath: [0, 1, 0] },
		localIndexFixture: {
			source: '> top\n>\n> > inner-a\n> >\n> > inner-b\n',
			containerChain: [0, 1],
			targetChild: 1
		},
		focusSource: '> a\n>\n> b\n',
		localIndex: { mode: 'assert' },
		ancestry: { mode: 'assert' },
		multiScope: {
			mode: 'exempt',
			reason:
				'blockquote inner ops (split/merge/delete) are single-scope; no ≥2-scope author op exists'
		},
		focusBubble: { mode: 'assert' },
		terminatorCollision: {
			mode: 'exempt',
			reason:
				'strip containerContract: rebuildRaw prefixes every emitted body line with the quote/indent marker, so no body byte reaches column 0 and the container has no terminator token a body line could reproduce'
		}
	},
	list: {
		// outer list > item 1 > nested list (local index 1) > [item, item].
		deepNesting: {
			source: '- top\n- second\n  - nested-a\n  - nested-b\n',
			leafPath: [0, 1, 1, 0, 0]
		},
		localIndexFixture: {
			source: '- top\n- second\n  - nested-a\n  - nested-b\n',
			containerChain: [0, 1, 1],
			targetChild: 1
		},
		focusSource: '- a\n- b\n',
		localIndex: { mode: 'assert' },
		ancestry: { mode: 'assert' },
		// indentItem / splitItemAtOffset / promoteNestedItem span ≥2 scopes via commitMultiScope.
		multiScope: { mode: 'assert' },
		focusBubble: { mode: 'assert' },
		terminatorCollision: {
			mode: 'exempt',
			reason:
				'strip containerContract: rebuildRaw prefixes every emitted body line with the quote/indent marker, so no body byte reaches column 0 and the container has no terminator token a body line could reproduce'
		}
	},
	listItem: {
		// list > item 1 (the listItem under test) > [paragraph, nested list].
		deepNesting: {
			source: '- lead\n- outer\n  - nested-a\n  - nested-b\n',
			leafPath: [0, 1, 1, 0, 0]
		},
		// item 1 has children [paragraph, nested-list]; target the nested-list child.
		localIndexFixture: {
			source: '- lead\n- outer\n  - nested-a\n  - nested-b\n',
			containerChain: [0, 1],
			targetChild: 1
		},
		// listItem can't be a parse root — it lives inside a list; the kit's walker
		// finds the listItem node (whose child is the inner paragraph).
		focusSource: '- a\n',
		localIndex: { mode: 'assert' },
		ancestry: { mode: 'assert' },
		multiScope: {
			mode: 'exempt',
			reason:
				'listItem author ops route through the parent list context; the listItem itself owns no ≥2-scope op'
		},
		focusBubble: { mode: 'assert' },
		terminatorCollision: {
			mode: 'exempt',
			reason:
				'strip containerContract: rebuildRaw prefixes every emitted body line with the quote/indent marker, so no body byte reaches column 0 and the container has no terminator token a body line could reproduce'
		}
	},
	table: {
		deepNesting: {
			source: '| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |\n',
			leafPath: [0, 2, 1]
		},
		// Grid local addressing (rows by index) is asserted via table-context.
		localIndex: { mode: 'assert' },
		ancestry: {
			mode: 'boundary',
			reason:
				'grid containerContract: rebuildTableRaw re-derives the ENTIRE table subtree (every row) ' +
				'in one rebuild, so the innermost-first ordering of a chained ancestry rebuild is moot — ' +
				'a single rebuild of the table already reflects any descendant cell edit.'
		},
		// commitColumnEdit spans the table scope + every row scope.
		multiScope: { mode: 'assert' },
		focusBubble: {
			mode: 'boundary',
			reason:
				'grid focus is cell-addressed (focusCell rowIdx/colIdx), not innerIndex delegation; the ' +
				'strip focus-bubble dispatcher is not on the table path. Exercising grid cell-to-cell ' +
				'bubbling would require mounting the table component under jsdom.'
		},
		terminatorCollision: {
			mode: 'boundary',
			reason:
				'grid containerContract: cells are re-emitted through the pipe/escape writer rather than wrapped between an opener and a terminator, so there is no terminator line to reproduce; cell-level delimiter escaping is covered by the table escaping suite'
		}
	},
	tableRow: {
		deepNesting: { source: '| h1 |\n| --- |\n| a |\n', leafPath: [0, 1, 0] },
		localIndex: {
			mode: 'boundary',
			reason:
				'tableRow has no standalone author action bundle — its cells are leaves and all row/column ' +
				'ops run through the table scope (createTableMutationsContext). Row local addressing is ' +
				'exercised via the `table` profile.'
		},
		ancestry: {
			mode: 'boundary',
			reason:
				'grid containerContract: tableRow raw is re-derived wholesale by its parent table’s ' +
				'rebuildTableRaw, so the innermost-first chained-rebuild ordering does not apply.'
		},
		multiScope: {
			mode: 'exempt',
			reason: 'tableRow owns no ≥2-scope op; column ops are owned by the enclosing table scope'
		},
		focusBubble: {
			mode: 'boundary',
			reason:
				'grid focus is cell-addressed; tableRow is not on the strip focus-bubble (innerIndex) path'
		},
		terminatorCollision: {
			mode: 'boundary',
			reason:
				'grid containerContract: cells are re-emitted through the pipe/escape writer rather than wrapped between an opener and a terminator, so there is no terminator line to reproduce; cell-level delimiter escaping is covered by the table escaping suite'
		}
	}
};
