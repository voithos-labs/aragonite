// Miss-analysis: the hook was only ever exercised by Playwright run from a shell, so a Playwright
// spawned from a Vitest test (which inherits VITEST) skipped it and fell back to a stale `dist`.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { SOURCE } from './source-paths';

const ROOT = path.resolve(__dirname, '../../../../..');
const HOOK = pathToFileURL(path.join(ROOT, 'scripts/lib-alias.mjs')).href;

function resolveInChild(env: Record<string, string>, specifier: string): string {
	const script = `import { resolveSelfImportsFromSource } from ${JSON.stringify(HOOK)};
resolveSelfImportsFromSource();
process.stdout.write(import.meta.resolve(${JSON.stringify(specifier)}));`;
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
		expect(resolveInChild({ VITEST: 'true' }, '@voithos-labs/aragonite/dev-checks')).toMatch(
			/\/src\/lib\/dev-checks\.ts$/
		);
	});

	// Miss-analysis: only the self-import was resolved here, never a name a plugin package imports.
	it("resolves a published entry point to this checkout's source", () => {
		const url = resolveInChild({}, '@voithos-labs/aragonite/plugin');
		expect(url).toBe(pathToFileURL(path.join(ROOT, SOURCE.pluginBarrel)).href);
	});
});
