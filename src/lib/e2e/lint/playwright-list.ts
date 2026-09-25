/**
 * What Playwright itself collects, for the lints that count specs and tests: one row per test
 * per project that runs it, read from `playwright test --list --reporter=json`. List mode loads
 * the specs without starting the web server or a browser.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

export interface ListedTest {
	project: string;
	/** Spec path relative to `src/lib/e2e/tests`. */
	file: string;
	/** The describe titles and the test title, joined with ` > `. */
	title: string;
	line: number;
	column: number;
}

interface ListedSuite {
	title: string;
	specs?: {
		title: string;
		file: string;
		line: number;
		column: number;
		tests: { projectName: string }[];
	}[];
	suites?: ListedSuite[];
}

/** The part of the JSON report the rows are read from. */
export interface ListReport {
	suites: ListedSuite[];
	errors: { message?: string }[];
}

export function listedTests(report: ListReport): ListedTest[] {
	const rows: ListedTest[] = [];
	function walk(suite: ListedSuite, titles: string): void {
		for (const spec of suite.specs ?? []) {
			for (const test of spec.tests) {
				rows.push({
					project: test.projectName,
					file: spec.file,
					title: `${titles} > ${spec.title}`,
					line: spec.line,
					column: spec.column
				});
			}
		}
		for (const child of suite.suites ?? []) walk(child, `${titles} > ${child.title}`);
	}
	for (const suite of report.suites) walk(suite, suite.title);
	return rows;
}

// Node's own lookup finds the Playwright CLI from a worktree that has no node_modules of its own.
const resolveModule = createRequire(import.meta.url).resolve;

/** Every listed test, and the load errors that would drop a spec from the list. */
export function listPlaywrightTests(): { tests: ListedTest[]; errors: string[] } {
	const run = spawnSync(
		process.execPath,
		[resolveModule('@playwright/test/cli'), 'test', '--list', '--reporter=json'],
		// The WebKit lane's specs belong to no other project, so they list only with it on.
		{ encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, WEBKIT: '1' } }
	);
	if (!run.stdout) throw new Error(`playwright test --list printed nothing: ${run.stderr}`);
	const report = JSON.parse(run.stdout) as ListReport;
	return {
		tests: listedTests(report),
		errors: report.errors.map((error) => error.message ?? JSON.stringify(error))
	};
}
