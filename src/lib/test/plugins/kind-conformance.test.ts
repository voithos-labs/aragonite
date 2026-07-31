import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { declaredPluginKind } from '$lib/plugin';
import { isBuiltinBlockKind } from '$lib/core/nodes';
import { DIRECTIVE_CONTAINER, DIRECTIVE_LEAF } from '$lib/core/directive/kinds';
import {
	augmentBlockKind,
	getAllRegisteredKinds,
	getBlockKindDescriptor
} from '$lib/schema/block-kind-descriptor';
import { listRegisteredOpeners } from '$lib/schema/block-openers';
import { resetPluginPlatformForTests, runKindConformance } from '$lib/testing';
import { registerMemoBlock, MEMO_BLOCK } from '../../../routes/test/plugins/memo/memo-kind';
import {
	registerCalloutKind,
	NOTE,
	NOTE_TITLE
} from '../../../routes/test/plugins/callout/callout-kind';
import { registerDetailsKind, DETAILS } from '$lib/plugins/details/details-kind';
import { registerFootnoteDefinition } from '$lib/plugins/footnotes/footnote-definition';
import { FOOTNOTE_DEF_KIND } from '$lib/plugins/footnotes';
import { registerAdmonitions } from '$lib/plugins/admonitions/admonition-kind';
import { ADMONITION, GITHUB_ALERT } from '$lib/plugins/admonitions/kinds';
import { registerMathBlock, MATH_BLOCK, MATH_FENCE } from '$lib/plugins/latex/latex-kind';
import { registerMermaidKind, MERMAID } from '$lib/plugins/mermaid/mermaid-kind';
import { registerTocBlock, TOC_BLOCK } from '$lib/plugins/toc/toc-plugin';

// The generic battery pointed at real PLUGIN kinds. They only exist once their setup
// installs them, so each case resets and re-installs — the platform is register-once
// (docs/contributing/culture.md).

const MEMO_KIND = () => declaredPluginKind(MEMO_BLOCK);
const NOTE_KIND = () => declaredPluginKind(NOTE);

const statusOf = (report: Awaited<ReturnType<typeof runKindConformance>>, column: string) =>
	report.cells.find((c) => c.column === column)?.status;

describe('kind conformance — plugin kinds enroll', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerMemoBlock();
		registerCalloutKind();
	});

	// The byte-slice copy cell EXECUTES through the same runner the built-ins use, so
	// the closure battery is not built-in-only.
	it('executes the byte-slice clipboard cell for an editable leaf', async () => {
		const report = await runKindConformance(MEMO_KIND());
		expect(statusOf(report, 'roundTrip')).toBe('executed');
		expect(statusOf(report, 'mergeBackspace')).toBe('executed');
		expect(statusOf(report, 'clipboard')).toBe('executed');
		expect(statusOf(report, 'focus')).toBe('boundary');
	});

	// A container kind: round-trip (rebuildRaw) and merge-role eligibility execute;
	// its kind-specific clipboard mechanism is boundary until the browser sweep.
	it('executes round-trip and merge cells for a container kind', async () => {
		const report = await runKindConformance(NOTE_KIND());
		expect(statusOf(report, 'roundTrip')).toBe('executed');
		expect(statusOf(report, 'mergeBackspace')).toBe('executed');
		expect(statusOf(report, 'clipboard')).toBe('boundary');
	});

	// Mirrors the bundled sweep below: chrome ride-ins run their fixture-free cells too,
	// so no registered kind sits outside every battery.
	it('every kind the dogfood registrars register executes its headless cells', async () => {
		const registered = getAllRegisteredKinds().filter((k) => !isBuiltinBlockKind(k));
		expect(registered).toContain(declaredPluginKind(NOTE_TITLE));
		for (const k of registered) {
			const report = await runKindConformance(k);
			expect(new Set(report.cells.map((c) => c.column))).toEqual(
				new Set(Object.keys(getBlockKindDescriptor(k).closure))
			);
		}
	});
});

// ── Bundled plugins: the shipped kinds enroll too ────────────────────────────
// Registering a bundled kind must enroll its headless cells exactly as a built-in's.
// The `$lib/plugins` DIRECTORY listing is the canonical bundled set (as for the
// plugin-pack-parity lint), so a dir born or dropped outside this table fails the dir
// lockstep below at birth.
const BUNDLED_INSTALLS: { dir: string; kind: string; install: () => void }[] = [
	{ dir: 'details', kind: DETAILS, install: registerDetailsKind },
	{ dir: 'footnotes', kind: FOOTNOTE_DEF_KIND, install: registerFootnoteDefinition },
	{ dir: 'admonitions', kind: ADMONITION, install: registerAdmonitions },
	{ dir: 'latex', kind: MATH_BLOCK, install: registerMathBlock },
	{ dir: 'mermaid', kind: MERMAID, install: registerMermaidKind },
	{ dir: 'toc', kind: TOC_BLOCK, install: registerTocBlock }
];

const NO_BLOCK_KIND_DIRS = new Set(['highlight-occurrences', 'emoji']);

describe('kind conformance — bundled plugin kinds enroll', () => {
	beforeEach(() => resetPluginPlatformForTests());

	// EVERY kind the registrar registers, not only the headline one: fixtureless chrome
	// kinds and directive-fallback ride-ins run their fixture-free cells too.
	it.each(BUNDLED_INSTALLS)(
		'$kind registrar: every registered kind executes its headless cells',
		async ({ kind, install }) => {
			install();
			const registered = getAllRegisteredKinds().filter((k) => !isBuiltinBlockKind(k));
			expect(registered).toContain(declaredPluginKind(kind));
			for (const k of registered) {
				const report = await runKindConformance(k);
				// One recorded cell per declared closure column — nothing silently dropped.
				expect(new Set(report.cells.map((c) => c.column))).toEqual(
					new Set(Object.keys(getBlockKindDescriptor(k).closure))
				);
			}
			const report = await runKindConformance(declaredPluginKind(kind));
			expect(statusOf(report, 'roundTrip')).toBe('executed');
			expect(statusOf(report, 'mergeBackspace')).toBe('executed');
		}
	);

	// Lockstep, dir tier: both directions, so neither an unenrolled new plugin nor a
	// stale entry for a deleted one survives.
	it('every plugin directory on disk is enrolled or a declared exception', () => {
		const dirs = readdirSync(path.resolve('src/lib/plugins'), { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name);
		const enrolled = new Set(BUNDLED_INSTALLS.map((b) => b.dir));
		const unaccounted = dirs.filter((d) => !enrolled.has(d) && !NO_BLOCK_KIND_DIRS.has(d));
		expect(unaccounted, 'plugin dirs neither enrolled nor declared kind-less').toEqual([]);
		const stale = [...enrolled, ...NO_BLOCK_KIND_DIRS].filter((d) => !dirs.includes(d));
		expect(stale, 'enrolled/exception entries with no plugin directory').toEqual([]);
	});

	// Lockstep, kind tier. The directive-fallback kinds ride in on `registerAdmonitions`
	// but are core, not bundled, and covered by `closure-fixtures.test.ts` + G1.24.
	// These two are second fixtured kinds co-registered under one dir.
	const CO_REGISTERED_FIXTURED = [GITHUB_ALERT, MATH_FENCE];
	it('sweeps exactly the bundled fixtured kinds', () => {
		for (const { install } of BUNDLED_INSTALLS) install();
		const directiveFallback = new Set<string>([DIRECTIVE_CONTAINER, DIRECTIVE_LEAF]);
		const registeredBundled = getAllRegisteredKinds()
			.filter((k) => !isBuiltinBlockKind(k))
			.filter((k) => getBlockKindDescriptor(k).conformanceFixture !== undefined)
			.filter((k) => !directiveFallback.has(k));
		expect(new Set(registeredBundled)).toEqual(
			new Set([...BUNDLED_INSTALLS.map((b) => b.kind), ...CO_REGISTERED_FIXTURED])
		);
	});

	// A shared opener priority is invisible to every isolated suite — it surfaces only
	// once the colliding plugins are co-installed AND a parse runs, which is why a tie
	// once survived to an e2e. Installing the whole bundle fails it here instead.
	it('the co-installed bundle declares distinct opener priorities', () => {
		for (const { install } of BUNDLED_INSTALLS) install();
		const kindsByPriority = new Map<number, string[]>();
		for (const { kind, priority } of listRegisteredOpeners()) {
			const kinds = kindsByPriority.get(priority) ?? [];
			kinds.push(kind);
			kindsByPriority.set(priority, kinds);
		}
		const ties = [...kindsByPriority.entries()]
			.filter(([, kinds]) => kinds.length > 1)
			.map(([priority, kinds]) => `${priority}: ${kinds.sort().join(', ')}`);
		expect(ties, `openers sharing a priority`).toEqual([]);
	});
});

// Non-vacuity: a battery that passes everything guards nothing, so these break a
// plugin registration on purpose and require the red.
describe('kind conformance — a broken plugin registration fails', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerMemoBlock();
	});

	// Profile drift: when an author's fixture stops producing their kind, the runner
	// must refuse the tree rather than exercise the wrong nodes.
	it('rejects a conformanceFixture that parses to the wrong kind', async () => {
		augmentBlockKind(MEMO_KIND(), { conformanceFixture: 'just a paragraph\n' });
		await expect(runKindConformance(MEMO_KIND())).rejects.toThrow(
			/conformanceFixture parses to no "memo" node/
		);
	});

	// A false `not-supported` reds because the degradation executor asserts the scan
	// finds NOTHING while this leaf's text is scannable. The clipboard analog needs a
	// synthesizing kind, so it lives in `test/invariants/kind-conformance.test.ts`.
	it('rejects a false searchPaint:not-supported on searchable text', async () => {
		const closure = getBlockKindDescriptor(MEMO_KIND()).closure;
		augmentBlockKind(MEMO_KIND(), {
			closure: {
				...closure,
				searchPaint: {
					mode: 'not-supported',
					reason: 'FALSE: memo text is searchable — red-test bait'
				}
			}
		});
		await expect(runKindConformance(MEMO_KIND())).rejects.toThrow(/finds no match/);
	});

	// Parity with the container kit's `assertExemptionDocumented`: an exempt cell must
	// carry a substantive reason, never a one-word placeholder that documents nothing.
	it('rejects an exempt cell whose declared reason is not substantive', async () => {
		const closure = getBlockKindDescriptor(MEMO_KIND()).closure;
		augmentBlockKind(MEMO_KIND(), {
			closure: { ...closure, reorder: { mode: 'not-supported', reason: 'n/a' } }
		});
		await expect(runKindConformance(MEMO_KIND())).rejects.toThrow(
			/reorder exempt reason is documented/
		);
	});
});
