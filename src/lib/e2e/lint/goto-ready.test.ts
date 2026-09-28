/**
 * Every e2e navigation goes through `gotoReady` or `reloadReady` (`e2e/goto-ready.ts`), which wait
 * for the route's readiness global, so no spec acts on server-rendered markup before hydration.
 * The matcher keys on the receiver: the Playwright page is spelled `page` across the e2e tree.
 * Miss-analysis: each spec wrote its own wait and no scan held them to one, so one waited on markup.
 */
import { describe, it, expect } from 'vitest';
import { collectFiles, readSource, type SourceFile } from '../../test/invariants/lint/scan-source';

const E2E_DIR = 'src/lib/e2e';

/** The one file allowed to navigate a page directly. */
const HELPER = 'src/lib/e2e/goto-ready.ts';

const RAW_NAVIGATION = /(?<![\w$])page\s*\.\s*(?:goto|reload|goBack|goForward)\s*\(/g;

const lineOf = (code: string, index: number) => code.slice(0, index).split('\n').length;

const rawNavigations = (files: Pick<SourceFile, 'relPath' | 'code'>[]): string[] =>
	files.flatMap((file) =>
		[...file.code.matchAll(RAW_NAVIGATION)].map(
			(m) => `${file.relPath}:${lineOf(file.code, m.index)} ${m[0].replace(/\s+/g, '')}`
		)
	);

describe('every e2e navigation waits for the route to hydrate', () => {
	const files = collectFiles(E2E_DIR, { extensions: ['.ts'] }).map(readSource);

	it('inspected the e2e sources', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it('no spec or helper navigates a page outside gotoReady', () => {
		expect(
			rawNavigations(files.filter((file) => file.relPath !== HELPER)),
			`navigate with gotoReady or reloadReady (${HELPER}): a raw navigation can act before hydration`
		).toEqual([]);
	});

	it('the helper holds both navigations it wraps', () => {
		const helper = files.filter((file) => file.relPath === HELPER);
		const methods = rawNavigations(helper).map((site) => site.slice(site.lastIndexOf('.') + 1));
		expect(methods).toEqual(['goto(', 'reload(']);
	});

	// ── Matcher self-test (non-vacuity) ──────────────────────────────────────

	it('matcher flags a page navigation on any receiver path, and spares EditorPage.goto', () => {
		// Spelled in pieces, so the scan of this file does not read them as calls.
		const nav = (receiver: string, call: string) => `await ${receiver}.${call}`;
		const flagged = rawNavigations([
			{ relPath: 'a.spec.ts', code: nav('page', "goto('/')") },
			{ relPath: 'b.spec.ts', code: nav('this.page', 'goto(url)') },
			{ relPath: 'c.spec.ts', code: nav('editor.page', 'reload()') },
			{ relPath: 'd.spec.ts', code: nav('page', 'goBack()') },
			{ relPath: 'e.spec.ts', code: nav('editor', "goto('?presentationMode=live')") },
			{ relPath: 'f.spec.ts', code: nav('homepage', "goto('/')") },
			{ relPath: 'g.spec.ts', code: "await gotoReady(page, '/', '__parityDocuments')" }
		]);
		expect(flagged.map((site) => site.split(':')[0])).toEqual([
			'a.spec.ts',
			'b.spec.ts',
			'c.spec.ts',
			'd.spec.ts'
		]);
	});
});
