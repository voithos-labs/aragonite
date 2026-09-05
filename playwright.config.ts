import { defineConfig } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> };
const PROD = !!process.env.PERF_PROD;
const WEBKIT = !!process.env.WEBKIT;
// A run that adopts a developer's live harness on the default port serves whatever that
// tree currently is, so a reviewer's battery moves both servers and reuses neither.
const ISOLATED = !!process.env.E2E_ISOLATED;
const DEV_PORT = ISOLATED ? 1430 : 1420;
const PROD_PORT = ISOLATED ? 1431 : 1421;

// `stdout: 'pipe'` routes the server's console through the reporters, which is what lets
// `server-warn-reporter` fail a run on an SSR-side `[aragonite:` guard fire. Stderr already pipes.
const devServer = {
	// `vite.config.js` pins the default port with `strictPort`, so isolation must move it on
	// the command line — Playwright's `port` only says where to wait.
	command: ISOLATED ? `npm run dev -- --port ${DEV_PORT} --strictPort` : 'npm run dev',
	port: DEV_PORT,
	reuseExistingServer: !ISOLATED,
	stdout: 'pipe' as const,
	timeout: 15_000
};

const prodServer = {
	command: `npm run build && npm run preview -- --port ${PROD_PORT} --strictPort`,
	port: PROD_PORT,
	reuseExistingServer: !ISOLATED,
	stdout: 'pipe' as const,
	timeout: 180_000
};

// Each dir gets its own `e2e-<dir>` project, and e2e-top ignores all of them so its specs never
// double-run. The projects carrying custom config stay hand-written below, their dirs ignored
// by hand.
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

// The second-engine slice, run per release rather than per commit. It carries no known-red
// backlog, which is what lets the lane fail rather than report: any red is a regression.
const WEBKIT_LANE = [
	'smoke.spec.ts',
	'source-prop.spec.ts',
	'text-editing/edge-cases.spec.ts',
	'text-editing/forward-delete.spec.ts',
	'text-editing/enter-at-block-start.spec.ts',
	'text-editing/enter-at-soft-break.spec.ts',
	'selection/pointer.spec.ts',
	'selection/keyboard/collapse.spec.ts',
	'selection/dead-space-click.spec.ts',
	'selection/gap-caret-arrival.spec.ts',
	'webkit/**/*.spec.ts'
];

export default defineConfig({
	testDir: './src/lib/e2e/tests',
	// A hang guard, not a budget: a first navigation onto a heavy route can outrun 30s under
	// many-worker contention on slower hosts, and a real hang still fails at 60.
	timeout: 60_000,
	retries: 0,
	use: {
		baseURL: `http://localhost:${DEV_PORT}`,
		headless: true,
		permissions: ['clipboard-read', 'clipboard-write'],
		// Pinned, not inherited: specs across several projects assert near-absolute geometry and
		// would turn red the day Playwright's implicit default moves. Projects may override.
		viewport: { width: 1280, height: 720 }
	},
	// Playwright's own default, kept explicit because the server watcher rides beside it.
	reporter: [[process.env.CI ? 'dot' : 'list'], ['./src/lib/e2e/server-warn-reporter.ts']],
	webServer: PROD ? [devServer, prodServer] : devServer,
	projects: [
		{
			name: 'e2e-top',
			testMatch: '*.spec.ts',
			testIgnore: [
				...PROJECT_DIRS.map((dir) => `${dir}/**`),
				'clipboard/**',
				'simulation/**',
				'perf/**',
				'capture/**',
				'webkit/**'
			]
		},
		{
			// Docs-asset capture, not a test: env-gated, and it writes into docs/assets.
			name: 'e2e-capture',
			testMatch: 'capture/**/*.spec.ts',
			use: { viewport: { width: 620, height: 900 }, deviceScaleFactor: 2 }
		},
		{
			name: 'e2e-simulation',
			testMatch: 'simulation/**/*.spec.ts',
			timeout: 180_000,
			// Each session is independent and the asserted artifact is the timing-independent
			// source, so scheduling cannot change an assertion. Capped: one browser per worker.
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
		...(WEBKIT
			? [
					{
						// WebKit throws on the clipboard permissions at CONTEXT creation, so no spec-level
						// guard can reach them; the lane's clipboard arm rides a dispatched event instead.
						name: 'e2e-webkit',
						testMatch: WEBKIT_LANE,
						use: { browserName: 'webkit' as const, permissions: [] }
					}
				]
			: []),
		...(PROD
			? [
					{
						name: 'e2e-perf-prod',
						testMatch: 'perf/**/*.perf.spec.ts',
						timeout: 600_000,
						use: {
							viewport: { width: 1280, height: 900 },
							baseURL: `http://localhost:${PROD_PORT}`
						}
					}
				]
			: [])
	]
});
