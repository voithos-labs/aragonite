// Miss-analysis: the hook was only ever exercised by Playwright run from a shell, so a Playwright
// spawned from a Vitest test (which inherits VITEST) skipped it and fell back to a stale `dist`.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../../..');
const HOOK = pathToFileURL(path.join(ROOT, 'scripts/lib-alias.mjs')).href;

function resolveInChild(env: Record<string, string>): string {
	const script = `import { resolveSelfImportsFromSource } from ${JSON.stringify(HOOK)};
resolveSelfImportsFromSource();
process.stdout.write(import.meta.resolve('@voithos-labs/aragonite/dev-checks'));`;
	const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
		cwd: ROOT,
		env: { ...process.env, ...env },
		encoding: 'utf8',
		timeout: 120_000
	});
	if (out.error) throw out.error;
	if (out.status !== 0) throw new Error(out.stderr);
	return out.stdout;
}

describe('a Node process the tests spawn resolves the self-imports to source', () => {
	it('even when it inherits the VITEST variable from the run that spawned it', () => {
		expect(resolveInChild({ VITEST: 'true' })).toMatch(/\/src\/lib\/dev-checks\.ts$/);
	});
});
