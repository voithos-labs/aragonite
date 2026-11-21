// The perf A/B probe's own config, apart from the suite's so no e2e or perf project collects it.
// It starts no web server: `scripts/ci/perf-ab.mjs` builds and serves each compared ref once and
// points every round at it through `PERF_AB_URL`.
import { defineConfig } from '@playwright/test';
import { resolveSelfImportsFromSource } from './scripts/lib-alias.mjs';

resolveSelfImportsFromSource();

declare const process: { env: Record<string, string | undefined> };

// What the e2e helpers read as "a production preview", whose page carries no test-only handles.
process.env.PERF_PROD = '1';

export default defineConfig({
	testDir: './src/lib/e2e/perf-ab',
	testMatch: 'gestures.spec.ts',
	timeout: 600_000,
	retries: 0,
	workers: 1,
	reporter: 'list',
	outputDir: process.env.PERF_AB_OUTPUT_DIR ?? 'test-results/perf-ab',
	use: {
		baseURL: process.env.PERF_AB_URL,
		browserName: 'chromium',
		headless: true,
		permissions: ['clipboard-read', 'clipboard-write'],
		// The perf projects' viewport, so the window mounts as many blocks as theirs do.
		viewport: { width: 1280, height: 900 }
	}
});
