import { test, expect } from '../../fixtures';
import { type ConsoleMessage, type Page } from '@playwright/test';
import { gotoReady } from '../../goto-ready';

// `/test/plugins/staggered` mounts editor 1 with `[calloutPlugin()]` at load and, on a click,
// editor 2 adding `detailsPlugin()`, read through `__test` and `__test2`. The late `details` opener
// registration fires `[invariant:late-opener-registration]`, which the fixture requires; the count
// here adds that it fires once, not twice.
test.use({ expectInvariants: ['late-opener-registration'] });

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
			if ((type === 'warning' || type === 'error') && m.text().includes('[aragonite:invariant:'))
				invariantFires.push(m.text());
		});

		await gotoReady(page, '/test/plugins/staggered');
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
		// `details` container, with the summary row at child 0, not to broken-up HTML.
		const details = blockOfKind(editorTwo, 'details');
		expect(details).toBeDefined();
		expect(details?.child0).toBe('details-summary');
		expect(kindsOf(editorTwo)).toContain('callout');
		expect(kindsOf(editorTwo)).not.toContain('htmlBlock');
	});

	test('editor 1 does not re-parse against the later grammar; one expected late-opener warn', async () => {
		// Editor 1 parsed before detailsPlugin existed, and a parsed document never re-parses, so
		// its `<details>` stays the built-in htmlBlock and never becomes `details`.
		expect(kindsOf(editorOne)).toContain('htmlBlock');
		expect(kindsOf(editorOne)).toContain('callout');
		expect(kindsOf(editorOne)).not.toContain('details');

		// The fixture requires the tag and forbids the rest, so all that is left to assert is the
		// count: a second registration would mean editor 1 re-parsed.
		await expect
			.poll(() => invariantFires.filter((f) => f.includes('late-opener-registration')).length)
			.toBe(1);
	});

	test('the shared callout plugin resolves the callout in both editors', () => {
		const noteOne = blockOfKind(editorOne, 'callout');
		const noteTwo = blockOfKind(editorTwo, 'callout');
		expect(noteOne?.child0).toBe('callout-title');
		expect(noteTwo?.child0).toBe('callout-title');
	});
});
