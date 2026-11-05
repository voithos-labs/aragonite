// The browser tests drive the dev page the way a person would, against a dev server of its own.
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 5180);

export default defineConfig({
	testDir: 'e2e',
	use: { baseURL: `http://localhost:${PORT}` },
	webServer: {
		command: `npx vite --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}`,
		reuseExistingServer: !process.env.CI
	},
	projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
