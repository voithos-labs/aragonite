import { describe, it, expect, beforeEach } from 'vitest';
import { declaredPluginKind } from '$lib/plugin';
import { augmentBlockKind, getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { resetPluginPlatformForTests, runKindConformance } from '$lib/testing';
import { registerMemoBlock, MEMO_BLOCK } from '../../../routes/test/plugins/memo/memo-kind';
import { registerCalloutKind, NOTE } from '../../../routes/test/plugins/callout/callout-kind';

// The generic battery pointed at real PLUGIN kinds — registering a plugin kind
// enrolls its headless cells exactly as a built-in's. Plugin kinds only exist once
// their setup installs them, so each case resets and re-installs (the platform is
// register-once — docs/contributing/culture.md).

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

	// An editable leaf with inherit-default clipboard: its byte-slice copy cell
	// EXECUTES green through the same runner the built-ins use — the closure battery
	// is not built-in-only.
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
});

// Non-vacuity. A battery that passes everything guards nothing — these break a
// plugin registration on purpose and require the red, mirroring the broken-unwrapRole
// / drifted-fixture pattern in `container-conformance.test.ts`.
describe('kind conformance — a broken plugin registration fails', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerMemoBlock();
	});

	// Profile drift: the author's fixture stops producing their kind (a renamed
	// opener, a declined recognizer). The runner must refuse a tree it never saw the
	// kind in, rather than exercising the wrong nodes.
	it('rejects a conformanceFixture that parses to the wrong kind', async () => {
		augmentBlockKind(MEMO_KIND(), { conformanceFixture: 'just a paragraph\n' });
		await expect(runKindConformance(MEMO_KIND())).rejects.toThrow(
			/conformanceFixture parses to no "memo" node/
		);
	});

	// A false `searchPaint: not-supported` on a searchable editable leaf: the
	// degradation executor asserts the document scan finds NOTHING, but the leaf's
	// text is scannable, so the scan DOES find it — the false cell goes red. The
	// clipboard analog (a false inherit-default on a synthesizing kind) is the
	// table-bug shape, reproduced against the real table in
	// `test/invariants/kind-conformance.test.ts` — a plugin leaf's copy is always a
	// true byte slice, so it cannot reproduce the synthesis.
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
});
