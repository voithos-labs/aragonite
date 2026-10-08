import { defineConfig } from '@playwright/test';

// `webServer` is config-level, not per-project: the dev server exists only for the
// dev-guard project, which needs `vite dev` for `import.meta.env.DEV` to be true.
export default defineConfig({
	testDir: './tests',
	// Each server is ready when it answers a page: Vite briefly opens the port while checking it
	// is free, so a port check can pass before the server is serving.
	webServer: [
		{
			command: 'npm run preview',
			url: 'http://localhost:4180/',
			reuseExistingServer: !process.env.CI
		},
		{
			command: 'npm run dev -- --port 4181 --strictPort',
			url: 'http://localhost:4181/dev-guard',
			reuseExistingServer: !process.env.CI
		}
	],
	projects: [
		{ name: 'preview', testIgnore: /dev-guard/, use: { baseURL: 'http://localhost:4180' } },
		{ name: 'dev-guard', testMatch: /dev-guard/, use: { baseURL: 'http://localhost:4181' } }
	]
});
