import { describe, it, expect, beforeEach } from 'vitest';
import { augmentBlockKind, declaredPluginKind, type UnwrapRole } from '$lib/plugin';
import {
	resetPluginPlatformForTests,
	reversedAncestryLeavesRootStale,
	runContainerConformance,
	type ContainerConformanceProfile
} from '$lib/testing';
import { registerCalloutKind, NOTE } from '../../../routes/test/plugins/callout/callout-kind';
import { registerDetailsKind, DETAILS } from '$lib/plugins/details/details-kind';

// The G4.3 kit pointed at real PLUGIN containers — the audience it is billed for.
// The built-in sweep (`test/invariants/container-conformance.test.ts`) derives its
// kinds from the descriptor registry; a plugin's kinds only exist once its suite
// installs them, so an author opts in explicitly with a profile of their own.

const NOTE_KIND = () => declaredPluginKind(NOTE);
const DETAILS_KIND = () => declaredPluginKind(DETAILS);

// outer `::::note` > inner `:::note` (child 1, after the reserved title) > [title, para, para].
const NESTED_NOTES = '::::note Outer\n:::note Inner\nA\n\nB\n:::\n::::\n';

// `:::note` > `<details>` (child 1) > [summary, para, para] — a plugin container
// nested in a DIFFERENT plugin container, so the chain is not note-shaped.
const NOTE_WRAPPING_DETAILS =
	':::note Wrapper\n<details open>\n<summary>S</summary>\n\nA\n\nB\n\n</details>\n:::\n';

const NO_MULTI_SCOPE_OP =
	'the callout/details containers own no ≥2-scope author op — their inner ops ' +
	'(split/merge/delete) are single-scope, like the blockquote';

const noteProfile: ContainerConformanceProfile = {
	deepNesting: { source: NESTED_NOTES, leafPath: [0, 1, 1] },
	localIndexFixture: { source: NESTED_NOTES, containerChain: [0, 1], targetChild: 2 },
	focusSource: ':::note T\nA\n\nB\n:::\n',
	terminatorCollisionFixture: {
		source: ':::note T\nbody\n:::\n',
		bodyRaw: 'before\n:::\nafter\n'
	},
	localIndex: { mode: 'assert' },
	ancestry: { mode: 'assert' },
	multiScope: { mode: 'exempt', reason: NO_MULTI_SCOPE_OP },
	focusBubble: { mode: 'assert' },
	terminatorCollision: { mode: 'assert' }
};

const detailsProfile: ContainerConformanceProfile = {
	deepNesting: { source: NOTE_WRAPPING_DETAILS, leafPath: [0, 1, 1] },
	localIndexFixture: { source: NOTE_WRAPPING_DETAILS, containerChain: [0, 1], targetChild: 2 },
	focusSource: '<details open>\n<summary>S</summary>\n\nA\n\nB\n\n</details>\n',
	// The two containers repair the same collision by opposite means: the callout
	// grows its own `:::` fence at rebuild, details escapes the body bytes at the
	// write sink. Both satisfy the cell.
	terminatorCollisionFixture: {
		source: '<details>\n<summary>T</summary>\n\nbody\n\n</details>\n',
		bodyRaw: '</details>\n'
	},
	localIndex: { mode: 'assert' },
	ancestry: { mode: 'assert' },
	multiScope: { mode: 'exempt', reason: NO_MULTI_SCOPE_OP },
	focusBubble: { mode: 'assert' },
	terminatorCollision: { mode: 'assert' }
};

describe('G4.3 conformance kit — plugin containers', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerCalloutKind();
		registerDetailsKind();
	});

	it('runs the whole kit over the callout container', async () => {
		const report = await runContainerConformance(NOTE_KIND(), noteProfile);

		expect(report.kind).toBe(NOTE);
		expect(report.cells.map((c) => `${c.cell}:${c.status}`)).toEqual([
			'localIndex:asserted',
			'ancestry:asserted',
			'multiScope:exempt',
			'focusBubble:asserted',
			'terminatorCollision:asserted',
			'declarations:asserted'
		]);
		expect(report.cells.find((c) => c.cell === 'multiScope')?.reason).toBe(NO_MULTI_SCOPE_OP);
	});

	// A second, differently-shaped container (HTML opener, not a `:::` directive)
	// nested inside the first: the kit is not callout-shaped.
	it('runs the whole kit over the details container', async () => {
		const report = await runContainerConformance(DETAILS_KIND(), detailsProfile);

		expect(report.kind).toBe(DETAILS);
		expect(report.cells.filter((c) => c.status === 'asserted').map((c) => c.cell)).toEqual([
			'localIndex',
			'ancestry',
			'focusBubble',
			'terminatorCollision',
			'declarations'
		]);
	});

	// Non-vacuity for the ancestry cell, the plugin analog of what the built-in
	// sweep asserts: an opaque container rebuilds from its direct children, so
	// rebuilding outer-first must leave the root's raw stale.
	it('ancestry check is non-vacuous: an outer-first rebuild leaves the callout root stale', () => {
		expect(reversedAncestryLeavesRootStale(noteProfile)).toBe(true);
	});
});

// Non-vacuity for the kit as a whole. A harness that passes everything guards
// nothing — these break a plugin container on purpose and require the red.
describe('G4.3 conformance kit — a broken plugin container fails', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerCalloutKind();
		registerDetailsKind();
	});

	// Non-vacuity for the terminator cell: with details' body-write rule replaced by
	// an identity, the terminator reaches the tree bare and truncates the container,
	// so the cell MUST fail. Testing the guard rather than a kind that happens to be
	// broken — if this stops throwing, the check has gone blind.
	it('fails terminatorCollision when the declared body-write rule neutralizes nothing', async () => {
		augmentBlockKind(DETAILS_KIND(), {
			container: { bodyWrite: { normalize: (raw) => raw, mapOffset: (_raw, offset) => offset } }
		});

		await expect(runContainerConformance(DETAILS_KIND(), detailsProfile)).rejects.toThrow(
			/terminatorCollision: details survives a body line reproducing its terminator/
		);
	});

	it('fails declaration sanity when unwrapRole names a strategy the registries do not implement', async () => {
		// The cast is the point: a JS plugin — or a stale strategy name that got past
		// a cast — can declare an unwrapRole nothing implements, and the nested
		// Backspace dispatcher indexes it unguarded.
		augmentBlockKind(NOTE_KIND(), {
			container: {
				unwrapRole: {
					firstChildBackspace: 'no-such-strategy' as UnwrapRole['firstChildBackspace'],
					middleChildBackspace: 'default-merge'
				}
			}
		});

		await expect(runContainerConformance(NOTE_KIND(), noteProfile)).rejects.toThrow(
			/declarations: note first-child unwrap strategy "no-such-strategy" is implemented/
		);
	});

	// Profile drift — the author's fixture stops producing their kind (a renamed
	// directive, a declined fence). The kit must not pass on a tree it never saw
	// the kind in.
	it('fails a deepNesting fixture whose tree holds no node of the kind', async () => {
		await expect(
			runContainerConformance(NOTE_KIND(), {
				...noteProfile,
				deepNesting: { source: '> a\n>\n> b\n', leafPath: [0, 1] }
			})
		).rejects.toThrow(/ancestry: "note" is on the leaf's ancestry/);
	});

	it('refuses an exempt cell whose reason is not substantive', async () => {
		await expect(
			runContainerConformance(NOTE_KIND(), {
				...noteProfile,
				multiScope: { mode: 'exempt', reason: 'n/a' }
			})
		).rejects.toThrow(/multiScope: note multiScope exempt reason is documented/);
	});
});
