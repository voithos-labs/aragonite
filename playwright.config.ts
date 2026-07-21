import { defineConfig } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> };
const PROD = !!process.env.PERF_PROD;

const devServer = {
	command: 'npm run dev',
	port: 1420,
	reuseExistingServer: true,
	timeout: 15_000
};

const prodServer = {
	command: 'npm run build && npm run preview -- --port 1421 --strictPort',
	port: 1421,
	reuseExistingServer: true,
	timeout: 180_000
};

// Each dir gets its own `e2e-<dir>` project, and e2e-top ignores all of them so its
// specs never double-run. The clipboard, simulation, and perf/vr projects carry
// custom config (nested ignore, parallelism, timeouts), so they stay hand-written
// below and their dirs are added to e2e-top's ignore by hand.
const PROJECT_DIRS = [
	'blocks',
	'decorations',
	'plugins',
	'presentation',
	'selection',
	'sticky-column',
	'a11y',
	'search'
];

export default defineConfig({
	testDir: './src/lib/e2e/tests',
	timeout: 30_000,
	retries: 0,
	use: {
		baseURL: 'http://localhost:1420',
		headless: true,
		permissions: ['clipboard-read', 'clipboard-write']
	},
	webServer: PROD ? [devServer, prodServer] : devServer,
	projects: [
		{
			name: 'e2e-top',
			testMatch: '*.spec.ts',
			testIgnore: [
				...PROJECT_DIRS.map((dir) => `${dir}/**`),
				'clipboard/**',
				'simulation/**',
				'perf/**'
			]
		},
		{
			name: 'e2e-simulation',
			testMatch: 'simulation/**/*.spec.ts',
			timeout: 180_000,
			// Each session is independent (own page, own seeded rng, no shared state),
			// so the multi-seed fuzz and the per-note captures run concurrently. Scoped
			// to this project — others keep their default within-file ordering. The
			// asserted artifact is the source, which is timing-independent, so parallel
			// scheduling can't change any end-state assertion. Capped well under the
			// core count: each worker drives a full browser against one dev server.
			fullyParallel: true,
			workers: 4,
			// Tall viewport: the editor scrolls internally, so a short viewport clips
			// a long note's trailing blocks out of the capture screenshots. A tall
			// fixed viewport keeps the whole note (and the agentic-review artifacts)
			// in frame and keeps pixel geometry deterministic.
			use: { viewport: { width: 1280, height: 1500 } }
		},
		{
			// Latency rows on 10MB fixtures spend minutes in load + per-keystroke
			// settles; the generous timeout is the budget for one full row.
			name: 'e2e-perf',
			testMatch: 'perf/**/*.perf.spec.ts',
			timeout: 600_000,
			use: { viewport: { width: 1280, height: 900 } }
		},
		{
			// VR correctness, not perf — runs in the default `npm test` battery (no
			// PERF gate, no `.perf.spec.ts` suffix). The longer timeout covers a
			// multi-MB fixture load; the fixed viewport makes the mounted-window
			// bound deterministic.
			name: 'e2e-vr',
			testMatch: 'perf/vr-*.spec.ts',
			timeout: 120_000,
			use: { viewport: { width: 1280, height: 900 } }
		},
		...PROJECT_DIRS.map((dir) => ({ name: `e2e-${dir}`, testMatch: `${dir}/**/*.spec.ts` })),
		{
			name: 'e2e-clipboard',
			testMatch: 'clipboard/**/*.spec.ts',
			testIgnore: 'clipboard/exploration/**/*'
		},
		{ name: 'e2e-exploration', testMatch: 'clipboard/exploration/**/*.spec.ts' },
		...(PROD
			? [
					{
						name: 'e2e-perf-prod',
						testMatch: 'perf/**/*.perf.spec.ts',
						timeout: 600_000,
						use: { viewport: { width: 1280, height: 900 }, baseURL: 'http://localhost:1421' }
					}
				]
			: [])
	]
});
