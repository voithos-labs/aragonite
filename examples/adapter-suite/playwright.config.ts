import { defineConfig } from '@playwright/test';
import { APPS } from './apps.mjs';

// One project per framework app, every app serving the same page contract
// (`requirements/page-contract.md`). `scripts/smoke/adapter-smoke.mjs` builds the apps first and names
// the projects in ADAPTER_PROJECTS, since a server starts only for a project that runs.
type AppName = keyof typeof APPS;
const chosen = (process.env.ADAPTER_PROJECTS ?? Object.keys(APPS).join(','))
	.split(',')
	.filter((name): name is AppName => name in APPS);

export default defineConfig({
	testDir: './tests',
	outputDir: './test-results',
	webServer: chosen.map((name) => ({
		command: APPS[name].command,
		cwd: APPS[name].cwd,
		url: `http://localhost:${APPS[name].port}/`,
		reuseExistingServer: !process.env.CI
	})),
	projects: chosen.map((name) => ({
		name,
		testMatch: APPS[name].specs.map((spec) => `${spec}.spec.ts`),
		use: { baseURL: `http://localhost:${APPS[name].port}` }
	}))
});
