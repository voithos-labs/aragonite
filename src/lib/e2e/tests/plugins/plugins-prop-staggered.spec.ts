import { test, expect } from '../../fixtures';
import { type ConsoleMessage, type Page } from '@playwright/test';

// The `/test/plugins/staggered` harness mounts editor 1 (`[calloutPlugin()]`) at load,
// then editor 2 (`[calloutPlugin(), detailsPlugin()]`) on a button click — a second
// editor arriving late with a plugin the first never had. These gates pin the
// additive-`plugins`-prop-for-late-mounts claim the design rests on, reading each
// editor's CST by path (`__test` / the distinct `__test2` handle).
//
// detailsPlugin registers the `details` opener AFTER editor 1 has parsed and consumed
// the grammar, so exactly one `[invariant:late-opener-registration]` is expected. The
// shared fixture blanket-forbids `[invariant:` fires, so this describe opts out and
// re-asserts the teeth locally: that one tag, nothing else.
test.use({ expectInvariants: true });

interface BlockInfo {
	kind: string;
	child0: string | null;
}

async function readKinds(page: Page, handle: '__test' | '__test2'): Promise<BlockInfo[]> {
	return page.evaluate((h) => {
		const doc = (window as unknown as Record<string, { getDocument(): unknown }>)[h].getDocument();
		const children = (doc as { children: { kind: string; children?: { kind: string }[] }[] })
			.children;
		return children.map((c) => ({ kind: c.kind, child0: c.children?.[0]?.kind ?? null }));
	}, handle);
}

const kindsOf = (blocks: BlockInfo[]): string[] => blocks.map((b) => b.kind);
const blockOfKind = (blocks: BlockInfo[], kind: string): BlockInfo | undefined =>
	blocks.find((b) => b.kind === kind);

test.describe('plugins prop: staggered second-editor mount', () => {
	let editorOne: BlockInfo[];
	let editorTwo: BlockInfo[];
	let invariantFires: string[];

	test.beforeEach(async ({ page }) => {
		invariantFires = [];
		page.on('console', (m: ConsoleMessage) => {
			const type = m.type();
			if ((type === 'warning' || type === 'error') && m.text().includes('[invariant:'))
				invariantFires.push(m.text());
		});

		await page.goto('/test/plugins/staggered');
		await page.waitForFunction(
			() => (window as unknown as { __test?: unknown }).__test !== undefined,
			null,
			{
				timeout: 10_000
			}
		);
		editorOne = await readKinds(page, '__test'); // editor 1 has already parsed

		await page.getByTestId('mount-second').click();
		await page.waitForFunction(
			() => (window as unknown as { __test2?: unknown }).__test2 !== undefined,
			null,
			{ timeout: 10_000 }
		);
		editorTwo = await readKinds(page, '__test2');
	});

	test('the late mount parses its own seed against the just-registered grammar', () => {
		// Editor 2 installed detailsPlugin before parsing, so `<details>` resolves to the
		// `details` container (summary chrome at child 0) — not fragmented HTML.
		const details = blockOfKind(editorTwo, 'details');
		expect(details).toBeDefined();
		expect(details?.child0).toBe('details-summary');
		expect(kindsOf(editorTwo)).toContain('note');
		expect(kindsOf(editorTwo)).not.toContain('htmlBlock');
	});

	test('editor 1 does not re-parse against the later grammar; one expected late-opener warn', async () => {
		// Editor 1 parsed before detailsPlugin existed, and parsed documents never
		// re-parse — so its `<details>` stays the built-in htmlBlock, never `details`.
		expect(kindsOf(editorOne)).toContain('htmlBlock');
		expect(kindsOf(editorOne)).toContain('note');
		expect(kindsOf(editorOne)).not.toContain('details');

		// The late details opener fires exactly one tagged invariant on editor 2's
		// mount; the fixture's blanket guard is off, so assert that boundary here.
		// Sound for one consumer (this local `.toBe(1)` requires the warn, which an
		// allowlist would let vanish silently). A SECOND opt-out consumer promotes a
		// per-tag require/allow into the invariant-watcher fixture (choke-point rule).
		await expect
			.poll(() => invariantFires.filter((f) => f.includes('late-opener-registration')).length)
			.toBe(1);
		expect(invariantFires.filter((f) => !f.includes('late-opener-registration'))).toEqual([]);
	});

	test('the shared callout plugin resolves the note in both editors', () => {
		const noteOne = blockOfKind(editorOne, 'note');
		const noteTwo = blockOfKind(editorTwo, 'note');
		expect(noteOne?.child0).toBe('note-title');
		expect(noteTwo?.child0).toBe('note-title');
	});
});
