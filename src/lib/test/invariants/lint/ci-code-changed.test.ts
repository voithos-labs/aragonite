/** Which changes CI treats as docs-only, the ones whose e2e and perf jobs skip their steps. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { touchesCode } from '../../../../../scripts/ci/ci-code-changed.mjs';
import { collectFiles, literalSpans, stringLiteralAt, stripComments } from './scan-source';

/** Every markdown path the app or the e2e harness loads, from the string literals naming one. */
function markdownTheAppLoads(): string[] {
	const files = collectFiles('src', { extensions: ['.ts', '.js', '.svelte'], skip: ['test'] });
	const loaded: string[] = [];
	for (const file of files) {
		const code = stripComments(readFileSync(file, 'utf8'), 'script');
		for (const span of literalSpans(code)) {
			const value = stringLiteralAt(code, span.start)?.value.replace(/\?raw$/, '');
			if (!value?.endsWith('.md') || !value.includes('/') || /\s/.test(value)) continue;
			const from = value.startsWith('.') ? path.dirname(file) : '.';
			loaded.push(path.posix.normalize(`${from}/${value}`).replaceAll('*', 'any'));
		}
	}
	return loaded;
}

describe('ci-code-changed: docs-only changes', () => {
	it.each([
		['a design doc', ['docs/design/editor.md']],
		['a markdown file anywhere', ['src/lib/e2e/requirements/smoke.md', 'README.md']],
		['an issue template', ['.github/ISSUE_TEMPLATE/bug.yml']],
		['a doc asset', ['docs/assets/caret.png']]
	])('%s is docs-only', (_, paths) => {
		expect(touchesCode(paths)).toBe(false);
	});

	it.each([
		['a source file', ['src/lib/core/parser.ts']],
		[
			'a spec beside its requirement file',
			['src/lib/e2e/requirements/smoke.md', 'src/lib/e2e/tests/smoke.spec.ts']
		],
		['a workflow', ['.github/workflows/ci.yml']],
		['a markdown-looking name that is not markdown', ['docs.mdx']]
	])('%s touches code', (_, paths) => {
		expect(touchesCode(paths)).toBe(true);
	});

	it('counts every markdown file the app renders as code', () => {
		const loaded = markdownTheAppLoads();
		expect(loaded).toContain('docs/changelog/any.md');
		expect(
			loaded.filter((file) => !touchesCode([file])),
			'the app loads markdown CI would skip the browser suites for; add it to APP_CONTENT in scripts/ci/ci-code-changed.mjs'
		).toEqual([]);
	});
});
