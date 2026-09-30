import { describe, it, expect, beforeEach } from 'vitest';
import {
	augmentBlockKind,
	declarePluginKind,
	declaredPluginKind,
	registerBlockKind,
	type BlockKindRegistration
} from '$lib/plugin';
import {
	reversedAncestryLeavesRootStale,
	runContainerConformance,
	type ContainerConformanceProfile
} from '$lib/testing';
import { checkDeclarationSanity } from '$lib/testing/container-conformance';
import { testClosure } from '$lib/test/support/closure';
import { registerCalloutKind, CALLOUT } from '../../../routes/test/plugins/callout/callout-kind';
import { registerDetailsKind, DETAILS } from '$lib/plugins/details/details-kind';

// The container conformance kit pointed at real plugin containers, the audience it is for.
// Unlike the built-in sweep (`test/invariants/container-conformance.test.ts`), which takes its
// kinds from the registry, an author opts in explicitly with a profile.

const CALLOUT_KIND = () => declaredPluginKind(CALLOUT);
const DETAILS_KIND = () => declaredPluginKind(DETAILS);

// outer `::::callout` > inner `:::callout` (child 1, after the reserved title) > [title, para, para].
const NESTED_CALLOUTS = '::::callout Outer\n:::callout Inner\nA\n\nB\n:::\n::::\n';

// `:::callout` > `<details>` (child 1) > [summary, para, para]: a plugin container nested
// in a different plugin container, so the chain is not all callouts.
const CALLOUT_WRAPPING_DETAILS =
	':::callout Wrapper\n<details open>\n<summary>S</summary>\n\nA\n\nB\n\n</details>\n:::\n';

const NO_MULTI_SCOPE_OP =
	'the callout/details containers own no ≥2-scope author op — their inner ops ' +
	'(split/merge/delete) are single-scope, like the blockquote';

const calloutProfile: ContainerConformanceProfile = {
	deepNesting: { source: NESTED_CALLOUTS, leafPath: [0, 1, 1] },
	localIndexFixture: { source: NESTED_CALLOUTS, containerChain: [0, 1], targetChild: 2 },
	focusSource: ':::callout T\nA\n\nB\n:::\n',
	terminatorCollisionFixture: {
		source: ':::callout T\nbody\n:::\n',
		bodyRaw: 'before\n:::\nafter\n'
	},
	localIndex: { mode: 'assert' },
	ancestry: { mode: 'assert' },
	multiScope: { mode: 'exempt', reason: NO_MULTI_SCOPE_OP },
	focusBubble: { mode: 'assert' },
	terminatorCollision: { mode: 'assert' }
};

const detailsProfile: ContainerConformanceProfile = {
	deepNesting: { source: CALLOUT_WRAPPING_DETAILS, leafPath: [0, 1, 1] },
	localIndexFixture: { source: CALLOUT_WRAPPING_DETAILS, containerChain: [0, 1], targetChild: 2 },
	focusSource: '<details open>\n<summary>S</summary>\n\nA\n\nB\n\n</details>\n',
	// The two containers repair the same collision by opposite means (callout grows its
	// fence, details escapes the bytes), and the cell accepts both.
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

describe('G4.3 conformance kit: plugin containers', () => {
	beforeEach(() => {
		registerCalloutKind();
		registerDetailsKind();
	});

	it('runs the whole kit over the callout container', async () => {
		const report = await runContainerConformance(CALLOUT_KIND(), calloutProfile);

		expect(report.kind).toBe(CALLOUT);
		expect(report.cells.map((c) => `${c.cell}:${c.status}`)).toEqual([
			'localIndex:asserted',
			'ancestry:asserted',
			'multiScope:exempt',
			'focusBubble:asserted',
			'terminatorCollision:asserted',
			'titleRow:asserted',
			'declarations:asserted'
		]);
		expect(report.cells.find((c) => c.cell === 'multiScope')?.detail).toBe(NO_MULTI_SCOPE_OP);
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
			'titleRow',
			'declarations'
		]);
	});

	// Non-vacuity for the ancestry cell: an opaque container rebuilds from its direct
	// children, so rebuilding outer-first must leave the root's raw stale.
	it('ancestry check is non-vacuous: an outer-first rebuild leaves the callout root stale', () => {
		expect(reversedAncestryLeavesRootStale(calloutProfile)).toBe(true);
	});
});

// Non-vacuity for the kit as a whole. A harness that passes everything guards
// nothing, so these break a plugin container on purpose and require the red.
describe('G4.3 conformance kit: a broken plugin container fails', () => {
	beforeEach(() => {
		registerCalloutKind();
		registerDetailsKind();
	});

	// Non-vacuity for the terminator cell: neutralize the body-write rule and the
	// terminator truncates the container, so if this stops throwing the check is blind.
	it('fails terminatorCollision when the declared body-write rule neutralizes nothing', async () => {
		augmentBlockKind(DETAILS_KIND(), {
			container: { bodyWrite: { normalize: (raw) => raw, mapOffset: (_raw, offset) => offset } }
		});

		await expect(runContainerConformance(DETAILS_KIND(), detailsProfile)).rejects.toThrow(
			/terminatorCollision: details survives a body line reproducing its terminator/
		);
	});

	// The cast is the point: a JS plugin can register an unwrapRole nothing implements, and the
	// nested Backspace dispatcher indexes it unguarded. Augment refuses the field, so it registers.
	it('fails declaration sanity when unwrapRole names a strategy the registries do not implement', () => {
		const kind = declarePluginKind('unwrap-typo');
		registerBlockKind(kind, {
			gapEdges: 'none',
			mergeRole: 'container',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			container: {
				contract: 'strip',
				rebuildRaw: () => {},
				unwrapRole: {
					firstChildBackspace: 'no-such-strategy',
					middleChildBackspace: 'default-merge'
				}
			}
		} as unknown as BlockKindRegistration);

		expect(() => checkDeclarationSanity(kind, calloutProfile)).toThrow(
			/unwrap-typo first-child unwrap strategy "no-such-strategy" is implemented/
		);
	});

	// Profile drift: when an author's fixture stops producing their kind, the kit must
	// not pass on a tree it never saw the kind in.
	it('fails a deepNesting fixture whose tree holds no node of the kind', async () => {
		await expect(
			runContainerConformance(CALLOUT_KIND(), {
				...calloutProfile,
				deepNesting: { source: '> a\n>\n> b\n', leafPath: [0, 1] }
			})
		).rejects.toThrow(/ancestry: "callout" is on the leaf's ancestry/);
	});

	// `bodyWrite` exists only to repair a terminator collision, so a profile excusing that
	// cell ships the repair unchecked behind a reason that reads as if it were reviewed.
	it('fails terminatorCollision when bodyWrite ships with the cell excused', async () => {
		await expect(
			runContainerConformance(DETAILS_KIND(), {
				...detailsProfile,
				terminatorCollision: {
					mode: 'boundary',
					reason: 'red-test bait: excusing the one cell that drives the bodyWrite repair'
				}
			})
		).rejects.toThrow(/terminatorCollision: details declares container\.bodyWrite/);
	});

	// Miss-analysis: only the bodyWrite branch of the excused-collision check had a case, so an
	// opaque container excusing the cell passed once that branch was dropped.
	it('fails terminatorCollision when an opaque container excuses it', async () => {
		await expect(
			runContainerConformance(CALLOUT_KIND(), {
				...calloutProfile,
				terminatorCollision: {
					mode: 'exempt',
					reason: 'red-test bait: an opaque container claiming its terminator cannot collide'
				}
			})
		).rejects.toThrow(/terminatorCollision: callout is an opaque container/);
	});

	// The bodyWrap check reads the descriptor's own fixture, so a container with none
	// leaves the declaration unchecked while the cell still reports asserted.
	it('fails declaration sanity when the container carries no conformanceFixture', async () => {
		augmentBlockKind(CALLOUT_KIND(), { conformanceFixture: undefined });

		await expect(runContainerConformance(CALLOUT_KIND(), calloutProfile)).rejects.toThrow(
			/declarations: callout declares no conformanceFixture/
		);
	});

	// Miss-analysis: no case hit the bodyWrap check's early return on a nested fixture (GH #78).
	// Callout is the hardest pick: its recognizer is the shared `:::` opener.
	it('fails declaration sanity when the conformanceFixture nests the kind', async () => {
		augmentBlockKind(CALLOUT_KIND(), { conformanceFixture: '> :::callout T\n> body\n> :::\n' });

		await expect(runContainerConformance(CALLOUT_KIND(), calloutProfile)).rejects.toThrow(
			/declarations: callout conformanceFixture must open a "callout" at the top level/
		);
	});

	// A fence container re-emits its body lines verbatim, so consuming the user's space would
	// swallow a byte no rebuild gives back: the declaration is wrong, not the rebuild.
	it('fails declaration sanity when contentStartSpace ships on a rebuild that creates no marker space', async () => {
		augmentBlockKind(CALLOUT_KIND(), { container: { contentStartSpace: 'complete-marker' } });

		await expect(runContainerConformance(CALLOUT_KIND(), calloutProfile)).rejects.toThrow(
			/declarations: callout declares container\.contentStartSpace/
		);
	});

	// The title row sits on the opener line, so naming it walks the open last line into the wrong one.
	it('fails declaration sanity when lastLineChild names a child above the last line', async () => {
		augmentBlockKind(CALLOUT_KIND(), { container: { lastLineChild: () => 0 } });

		await expect(runContainerConformance(CALLOUT_KIND(), calloutProfile)).rejects.toThrow(
			/declarations: callout names child 0 as holding its last line/
		);
	});

	it('refuses an exempt cell whose reason is not substantive', async () => {
		await expect(
			runContainerConformance(CALLOUT_KIND(), {
				...calloutProfile,
				multiScope: { mode: 'exempt', reason: 'n/a' }
			})
		).rejects.toThrow(/multiScope: callout multiScope exempt reason is documented/);
	});
});
