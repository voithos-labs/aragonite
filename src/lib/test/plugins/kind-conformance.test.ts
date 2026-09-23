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
import {
	checkCopyIsRawByteSlice,
	resetPluginPlatformForTests,
	runKindConformance
} from '$lib/testing';
import { registerMemoBlock, MEMO_BLOCK } from '../../../routes/test/plugins/memo/memo-kind';
import {
	registerCalloutKind,
	CALLOUT,
	CALLOUT_TITLE
} from '../../../routes/test/plugins/callout/callout-kind';
import { registerDetailsKind, DETAILS } from '$lib/plugins/details/details-kind';
import { registerFootnoteDefinition } from '$lib/plugins/footnotes/footnote-definition';
import { FOOTNOTE_DEF_KIND } from '$lib/plugins/footnotes';
import { registerAdmonitions } from '$lib/plugins/admonitions/admonition-kind';
import { ADMONITION, GITHUB_ALERT } from '$lib/plugins/admonitions/kinds';
import { registerMathBlock, MATH_BLOCK, MATH_FENCE } from '$lib/plugins/latex/latex-kind';
import { registerMermaidKind, MERMAID } from '$lib/plugins/mermaid/mermaid-kind';
import { registerTocBlock, TOC_BLOCK } from '$lib/plugins/toc/toc-plugin';
import { parrotPlugin, PARROT } from '$lib/plugins/parrot';
import { installPlugins } from '$lib';

// The generic battery pointed at real plugin kinds. They only exist once their setup installs
// them, so each case resets and re-installs; the platform registers each thing once
// (docs/contributing/casebook.md).

const MEMO_KIND = () => declaredPluginKind(MEMO_BLOCK);
const CALLOUT_KIND = () => declaredPluginKind(CALLOUT);

const statusOf = (report: Awaited<ReturnType<typeof runKindConformance>>, column: string) =>
	report.cells.find((c) => c.column === column)?.status;

describe('kind conformance: plugin kinds enroll', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerMemoBlock();
		registerCalloutKind();
	});

	// The byte-slice copy cell runs through the same runner the built-ins use, so the
	// closure battery is not built-in only.
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
		const report = await runKindConformance(CALLOUT_KIND());
		expect(statusOf(report, 'roundTrip')).toBe('executed');
		expect(statusOf(report, 'mergeBackspace')).toBe('executed');
		expect(statusOf(report, 'clipboard')).toBe('boundary');
	});

	// Mirrors the bundled sweep below: the extra kinds a registrar adds run their
	// fixture-free cells too, so no registered kind sits outside every battery.
	it('every kind the dogfood registrars register executes its headless cells', async () => {
		const registered = getAllRegisteredKinds().filter((k) => !isBuiltinBlockKind(k));
		expect(registered).toContain(declaredPluginKind(CALLOUT_TITLE));
		for (const k of registered) {
			const report = await runKindConformance(k);
			expect(new Set(report.cells.map((c) => c.column))).toEqual(
				new Set(Object.keys(getBlockKindDescriptor(k).closure))
			);
		}
	});
});

// ── Bundled plugins: the shipped kinds enroll too ────────────────────────────
// Registering a bundled kind must enroll its headless cells exactly as a built-in's. The
// `$lib/plugins` directory listing is the canonical bundled set (as for the plugin-pack-parity
// lint), so a directory added or dropped outside this table fails the check below at once.
const BUNDLED_INSTALLS: { dir: string; kind: string; install: () => void }[] = [
	{ dir: 'details', kind: DETAILS, install: registerDetailsKind },
	{ dir: 'footnotes', kind: FOOTNOTE_DEF_KIND, install: registerFootnoteDefinition },
	{ dir: 'admonitions', kind: ADMONITION, install: registerAdmonitions },
	{ dir: 'latex', kind: MATH_BLOCK, install: registerMathBlock },
	{ dir: 'mermaid', kind: MERMAID, install: registerMermaidKind },
	{ dir: 'toc', kind: TOC_BLOCK, install: registerTocBlock },
	// The parrot's registration function is module-private (it keeps the guide's bytes), so
	// installing the plugin is the way in, the same one a consumer uses.
	{ dir: 'parrot', kind: PARROT, install: () => installPlugins([parrotPlugin()]) }
];

const NO_BLOCK_KIND_DIRS = new Set(['highlight-occurrences', 'emoji', 'slash-commands']);

describe('kind conformance: bundled plugin kinds enroll', () => {
	beforeEach(() => resetPluginPlatformForTests());

	// Every kind the registrar registers, not only the headline one: title kinds with no
	// fixture and directive-fallback kinds run their fixture-free cells too.
	it.each(BUNDLED_INSTALLS)(
		'$kind registrar: every registered kind executes its headless cells',
		async ({ kind, install }) => {
			install();
			const registered = getAllRegisteredKinds().filter((k) => !isBuiltinBlockKind(k));
			expect(registered).toContain(declaredPluginKind(kind));
			for (const k of registered) {
				const report = await runKindConformance(k);
				// One recorded cell per declared closure column, so nothing is silently dropped.
				expect(new Set(report.cells.map((c) => c.column))).toEqual(
					new Set(Object.keys(getBlockKindDescriptor(k).closure))
				);
			}
			const report = await runKindConformance(declaredPluginKind(kind));
			expect(statusOf(report, 'roundTrip')).toBe('executed');
			expect(statusOf(report, 'mergeBackspace')).toBe('executed');
		}
	);

	// The kind whose clipboard cell says a cross-block range carries it whole: that is backed
	// by the kit's byte check, not by prose, since the runner sends an `implemented` cell to
	// the browser sweep and would never run it.
	it('mermaid backs its cross-block clipboard claim with the byte-slice check', () => {
		registerMermaidKind();
		const kind = declaredPluginKind(MERMAID);
		expect(() =>
			checkCopyIsRawByteSlice(kind, getBlockKindDescriptor(kind).conformanceFixture!)
		).not.toThrow();
	});

	// Checked both ways at the directory level, so neither an unenrolled new plugin nor a
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

	// The same check at the kind level. The directive-fallback kinds come in with
	// `registerAdmonitions` but are core, not bundled, and covered by `closure-fixtures.test.ts`
	// and G1.24. These two are second fixtured kinds registered under one directory.
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

	// A shared opener priority is invisible to every isolated suite: it shows only once the
	// colliding plugins are installed together and a parse runs, which is why a tie once
	// reached an e2e. Installing the whole bundle fails it here instead.
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
describe('kind conformance: a broken plugin registration fails', () => {
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

	// A false `not-supported` fails because the degradation check asserts the scan finds
	// nothing while this block's text is scannable. The clipboard equivalent needs a kind
	// that builds its own bytes, so it lives in `test/invariants/kind-conformance.test.ts`.
	it('rejects a false searchPaint:not-supported on searchable text', async () => {
		const closure = getBlockKindDescriptor(MEMO_KIND()).closure;
		augmentBlockKind(MEMO_KIND(), {
			closure: {
				...closure,
				searchPaint: {
					mode: 'not-supported',
					reason: 'FALSE: memo text is searchable; red-test bait'
				}
			}
		});
		await expect(runKindConformance(MEMO_KIND())).rejects.toThrow(/finds no match/);
	});

	// The kit uses the fixture's first block as the subject (undo deletes it, the byte-slice
	// copy starts from it), so a kind sitting under a later block leaves the undo cell
	// deleting something else and reporting `executed`.
	it('rejects a conformanceFixture whose kind is not under the first block', async () => {
		registerAdmonitions();
		const alert = declaredPluginKind(GITHUB_ALERT);
		augmentBlockKind(alert, {
			conformanceFixture: 'lead paragraph\n\n> > [!NOTE]\n> > Heads up.\n'
		});

		await expect(runKindConformance(alert)).rejects.toThrow(
			/conformanceFixture must open with the "githubAlert" block/
		);
	});

	// The undo cell's trailing marker must parse as a block of its own: a fixture running to
	// the end of the input swallows it, and deleting the document's only block still pushes
	// one entry.
	it('rejects a conformanceFixture that swallows the undo cell sentinel', async () => {
		registerMermaidKind();
		const kind = declaredPluginKind(MERMAID);
		const closure = getBlockKindDescriptor(kind).closure;
		augmentBlockKind(kind, {
			conformanceFixture: '```mermaid\ngraph TD\n',
			closure: { ...closure, undo: { mode: 'inherit-default' } }
		});

		await expect(runKindConformance(kind)).rejects.toThrow(/trailing sentinel/);
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
