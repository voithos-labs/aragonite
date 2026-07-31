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

// Each dir gets its own `e2e-<dir>` project, and e2e-top ignores all of them so its specs
// never double-run. The clipboard, simulation, and perf/vr projects carry custom config,
// so they stay hand-written below and their dirs join e2e-top's ignore by hand.
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
		permissions: ['clipboard-read', 'clipboard-write'],
		// Pinned, not inherited: specs across several projects assert near-absolute geometry
		// and would turn red the day Playwright's implicit default moves. This is that
		// default made explicit, so pinning changes no measurement; projects may override.
		viewport: { width: 1280, height: 720 }
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
			// Each session is independent (own page, own seeded rng, no shared state) and the
			// asserted artifact is the timing-independent source, so parallel scheduling can't
			// change an assertion. Capped: each worker drives a full browser on one dev server.
			fullyParallel: true,
			workers: 4,
			// The editor scrolls internally, so a short viewport clips a long note's trailing
			// blocks out of the capture screenshots; fixed, so pixel geometry stays deterministic.
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
			// VR correctness, not perf: `vr-*.spec.ts` under `perf/` rides the default `npm test`
			// battery while `*.perf.spec.ts` stays env-gated — the glob partition G4.17 guards.
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
