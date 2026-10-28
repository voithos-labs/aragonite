import { describe, it, expect, beforeEach } from 'vitest';
import { bundledPluginDirs } from '../invariants/lint/scan-source';
import { isBuiltinBlockKind } from '#lib/core/nodes.js';
import { DIRECTIVE_CONTAINER, DIRECTIVE_LEAF } from '#lib/core/directive/kinds.js';
import {
	augmentBlockKind,
	getAllRegisteredKinds,
	getBlockKindDescriptor,
	openerRecords
} from '#lib/schema/block-kind-descriptor.js';
import { checkCopyIsRawByteSlice, runKindConformance } from '#lib/testing.js';
import { registerMemoBlock, MEMO_BLOCK } from '../../../routes/test/plugins/memo/memo-kind';
import {
	registerCalloutKind,
	CALLOUT,
	CALLOUT_TITLE
} from '../../../routes/test/plugins/callout/callout-kind';
import { registerDetailsKind, DETAILS } from '#lib/plugins/details/details-kind.js';
import { registerFootnoteDefinition } from '#lib/plugins/footnotes/footnote-definition.js';
import { FOOTNOTE_DEF_KIND } from '#lib/plugins/footnotes/index.js';
import { registerAdmonitions } from '#lib/plugins/admonitions/admonition-kind.js';
import { ADMONITION, GITHUB_ALERT } from '#lib/plugins/admonitions/kinds.js';
import { registerMathBlock, MATH_BLOCK, MATH_FENCE } from '#lib/plugins/latex/latex-kind.js';
import { registerMermaidKind, MERMAID } from '#lib/plugins/mermaid/mermaid-kind.js';
import { registerTocBlock, TOC_BLOCK } from '#lib/plugins/toc/toc-plugin.js';
import { parrotPlugin, PARROT } from '#lib/plugins/parrot/index.js';
import { installPlugins } from '#lib';
import { testView } from '#lib/test/harness/test-view.js';
import type { BlockView } from '#lib/schema/block-view.js';
import type { UnfinishedReading } from '#lib/schema/block-openers.js';
import { OPENER_PRIORITIES } from '#lib/schema/opener-priorities.js';
import {
	declaredPluginKind,
	fenceRawWrite,
	fenceReading,
	fenceShapeOfRaw,
	matchFenceInfo,
	scanFence
} from '#lib/plugin.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';

// The generic battery pointed at real plugin kinds, which exist only once their setup installs
// them, so each case resets and re-installs.

const MEMO_KIND = () => declaredPluginKind(MEMO_BLOCK);
const CALLOUT_KIND = () => declaredPluginKind(CALLOUT);

const statusOf = (report: Awaited<ReturnType<typeof runKindConformance>>, cell: string) =>
	report.cells.find((c) => c.cell === cell)?.status;

describe('kind conformance: plugin kinds enroll', () => {
	beforeEach(() => {
		registerMemoBlock(testView());
		registerCalloutKind(testView());
	});

	// The byte-slice copy cell runs through the same runner the built-ins use, so the
	// closure battery is not built-in only.
	it('executes the byte-slice clipboard cell for an editable leaf', async () => {
		const report = await runKindConformance(MEMO_KIND());
		expect(statusOf(report, 'roundTrip')).toBe('asserted');
		expect(statusOf(report, 'mergeBackspace')).toBe('asserted');
		expect(statusOf(report, 'clipboard')).toBe('asserted');
		expect(statusOf(report, 'focus')).toBe('boundary');
	});

	// A container kind: round-trip (rebuildRaw) and merge-role eligibility execute;
	// its kind-specific clipboard mechanism is boundary until the browser sweep.
	it('executes round-trip and merge cells for a container kind', async () => {
		const report = await runKindConformance(CALLOUT_KIND());
		expect(statusOf(report, 'roundTrip')).toBe('asserted');
		expect(statusOf(report, 'mergeBackspace')).toBe('asserted');
		expect(statusOf(report, 'clipboard')).toBe('boundary');
	});

	// Mirrors the bundled sweep below: the extra kinds a registrar adds run their
	// fixture-free cells too, so no registered kind sits outside every battery.
	it('every kind the dogfood registrars register executes its headless cells', async () => {
		const registered = getAllRegisteredKinds().filter((k) => !isBuiltinBlockKind(k));
		expect(registered).toContain(declaredPluginKind(CALLOUT_TITLE));
		for (const k of registered) {
			const report = await runKindConformance(k);
			expect(new Set(report.cells.map((c) => c.cell))).toEqual(
				new Set([
					...Object.keys(getBlockKindDescriptor(k).closure),
					'rawWrite',
					'unfinishedReading'
				])
			);
		}
	});
});

// ── A fence kind's reading ───────────────────────────────────────────────────

/** A plugin kind claiming ```demo fences, its opener declaring `reading` or nothing. */
function demoFence(name: string, reading?: UnfinishedReading) {
	const match = matchFenceInfo('demo');
	return testLeaf(name, (kind) => ({
		conformanceFixture: '```demo\nx\n```\n',
		rawWrite: fenceRawWrite(fenceShapeOfRaw),
		opener: {
			priority: OPENER_PRIORITIES.fencedCode - 6,
			interruptsParagraph: (line) => match(line) !== null,
			readingNotFinal: reading,
			tryOpen(ctx) {
				const fence = match(ctx.line.text);
				if (!fence) return null;
				const scan = scanFence(ctx, fence);
				return {
					node: { kind, leadingTrivia: ctx.leadingTrivia, raw: scan.raw },
					consumed: scan.consumed
				};
			}
		}
	}));
}

// Miss-analysis: the cell reported a fence kind with no reading as exempt, so a plugin fence
// that omitted it lost the re-pairing below an edited opener without a red anywhere.
describe('kind conformance: a fence kind declares the fence reading', () => {
	it('fails a fence kind whose opener declares no readingNotFinal', async () => {
		await expect(runKindConformance(demoFence('demo-fence-bare'))).rejects.toThrow(
			/declares no readingNotFinal: declare fenceReading/
		);
	});

	it('asserts a fence kind declaring fenceReading', async () => {
		const report = await runKindConformance(demoFence('demo-fence-read', fenceReading));
		expect(statusOf(report, 'unfinishedReading')).toBe('asserted');
	});
});

// ── A backing-out kind's closer ──────────────────────────────────────────────

/** A `@@`-bounded kind that, unclosed, backs out to a paragraph, as `$$` does; its reading names
 *  `closer` for the line that closes it. */
function backingOut(name: string, fence: string, closer: UnfinishedReading['closer']) {
	const awaitsCloser = (raw: string) => {
		const [opener, ...rest] = raw.split('\n');
		return opener === fence && !rest.includes(fence);
	};
	return testLeaf(name, (kind) => ({
		conformanceFixture: `${fence}\nx\n${fence}\n`,
		opener: {
			priority: OPENER_PRIORITIES.fencedCode + 7,
			interruptsParagraph: (line) => line === fence,
			readingNotFinal: { notFinal: awaitsCloser, mayClose: (line) => line === fence, closer },
			tryOpen(ctx) {
				if (ctx.line.text !== fence) return null;
				let close = ctx.index + 1;
				while (close < ctx.end && ctx.lines[close].text !== fence) close++;
				if (close >= ctx.end) return null;
				const raw = ctx.lines
					.slice(ctx.index, close + 1)
					.map((line) => line.raw)
					.join('');
				return {
					node: { kind, leadingTrivia: ctx.leadingTrivia, raw },
					consumed: close + 1 - ctx.index
				};
			}
		}
	}));
}

// Miss-analysis: the cell asked only `mayClose` of a backing-out opener, so a reading with no
// closer let an opener typed on its own line take in every block below it.
describe('kind conformance: a backing-out kind names its closer', () => {
	it('fails a backing-out kind whose reading declares no closer', async () => {
		await expect(runKindConformance(backingOut('bare-closer', '@@1', null))).rejects.toThrow(
			/declares no closer/
		);
	});

	it('fails a closer that leaves the fixture open', async () => {
		await expect(runKindConformance(backingOut('wrong-closer', '@@2', () => '@@'))).rejects.toThrow(
			/doesn't close its fixture/
		);
	});

	it('asserts a closer that closes the fixture', async () => {
		const report = await runKindConformance(backingOut('own-closer', '@@3', () => '@@3'));
		expect(statusOf(report, 'unfinishedReading')).toBe('asserted');
	});
});

// ── Bundled plugins: the shipped kinds enroll too ────────────────────────────
// The `src/lib/plugins` directory listing is the bundled set, so a plugin directory added or
// dropped outside this table fails the check below at once.
const BUNDLED_INSTALLS: { dir: string; kind: string; install: (view: BlockView) => void }[] = [
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
	// Every kind the registrar registers, not only the headline one: title kinds with no
	// fixture and directive-fallback kinds run their fixture-free cells too.
	it.each(BUNDLED_INSTALLS)(
		'$kind registrar: every registered kind executes its headless cells',
		async ({ kind, install }) => {
			install(testView());
			const registered = getAllRegisteredKinds().filter((k) => !isBuiltinBlockKind(k));
			expect(registered).toContain(declaredPluginKind(kind));
			for (const k of registered) {
				const report = await runKindConformance(k);
				// One recorded cell per declared closure column plus the raw-write cell, so none is dropped.
				expect(new Set(report.cells.map((c) => c.cell))).toEqual(
					new Set([
						...Object.keys(getBlockKindDescriptor(k).closure),
						'rawWrite',
						'unfinishedReading'
					])
				);
			}
			const report = await runKindConformance(declaredPluginKind(kind));
			expect(statusOf(report, 'roundTrip')).toBe('asserted');
			expect(statusOf(report, 'mergeBackspace')).toBe('asserted');
		}
	);

	// Mermaid's claim that a cross-block copy carries it whole needs the kit's byte check, since
	// the runner sends an `implemented` cell to the browser sweep and would never run it.
	it('mermaid backs its cross-block clipboard claim with the byte-slice check', () => {
		registerMermaidKind(testView());
		const kind = declaredPluginKind(MERMAID);
		expect(() =>
			checkCopyIsRawByteSlice(kind, getBlockKindDescriptor(kind).conformanceFixture!)
		).not.toThrow();
	});

	// Checked both ways at the directory level, so neither an unenrolled new plugin nor a
	// stale entry for a deleted one survives.
	it('every plugin directory on disk is enrolled or a declared exception', () => {
		const dirs = bundledPluginDirs();
		const enrolled = new Set(BUNDLED_INSTALLS.map((b) => b.dir));
		const unaccounted = dirs.filter((d) => !enrolled.has(d) && !NO_BLOCK_KIND_DIRS.has(d));
		expect(unaccounted, 'plugin dirs neither enrolled nor declared kind-less').toEqual([]);
		const stale = [...enrolled, ...NO_BLOCK_KIND_DIRS].filter((d) => !dirs.includes(d));
		expect(stale, 'enrolled/exception entries with no plugin directory').toEqual([]);
	});

	// The same check per kind, for a directory's second fixtured kind. The directive-fallback
	// kinds `registerAdmonitions` adds are core, covered by `closure-fixtures.test.ts`.
	const CO_REGISTERED_FIXTURED = [GITHUB_ALERT, MATH_FENCE];
	it('sweeps exactly the bundled fixtured kinds', () => {
		for (const { install } of BUNDLED_INSTALLS) install(testView());
		const directiveFallback = new Set<string>([DIRECTIVE_CONTAINER, DIRECTIVE_LEAF]);
		const registeredBundled = getAllRegisteredKinds()
			.filter((k) => !isBuiltinBlockKind(k))
			.filter((k) => getBlockKindDescriptor(k).conformanceFixture !== undefined)
			.filter((k) => !directiveFallback.has(k));
		expect(new Set(registeredBundled)).toEqual(
			new Set([...BUNDLED_INSTALLS.map((b) => b.kind), ...CO_REGISTERED_FIXTURED])
		);
	});

	// A shared opener priority shows only once the colliding plugins install together and a
	// parse runs, so every isolated suite misses it; installing the whole bundle catches it.
	it('the co-installed bundle declares distinct opener priorities', () => {
		for (const { install } of BUNDLED_INSTALLS) install(testView());
		const kindsByPriority = new Map<number, string[]>();
		for (const { key: kind, value } of openerRecords()) {
			const { priority } = value;
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
		registerMemoBlock(testView());
	});

	// Profile drift: when an author's fixture stops producing their kind, the runner
	// must refuse the tree rather than exercise the wrong nodes.
	it('rejects a conformanceFixture that parses to the wrong kind', async () => {
		augmentBlockKind(MEMO_KIND(), { conformanceFixture: 'just a paragraph\n' });
		await expect(runKindConformance(MEMO_KIND())).rejects.toThrow(
			/conformanceFixture parses to no "memo" node/
		);
	});

	// A false `not-supported` fails because the degradation check asserts the scan finds nothing
	// in scannable text; the clipboard case is in `test/invariants/kind-conformance.test.ts`.
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

	// Undo and the byte-slice copy both act on the fixture's first block, so a kind under a
	// later block lets the undo cell delete something else and still report `asserted`.
	it('rejects a conformanceFixture whose kind is not under the first block', async () => {
		registerAdmonitions(testView());
		const alert = declaredPluginKind(GITHUB_ALERT);
		augmentBlockKind(alert, {
			conformanceFixture: 'lead paragraph\n\n> > [!NOTE]\n> > Heads up.\n'
		});

		await expect(runKindConformance(alert)).rejects.toThrow(
			/conformanceFixture must open with the "githubAlert" block/
		);
	});

	// The undo cell's trailing marker must parse as its own block: a fixture that swallows it
	// leaves one block, and deleting a document's only block still pushes an undo entry.
	it('rejects a conformanceFixture that swallows the undo cell sentinel', async () => {
		registerMermaidKind(testView());
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
