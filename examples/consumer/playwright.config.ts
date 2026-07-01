import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	webServer: {
		command: 'npm run preview',
		port: 4180,
		reuseExistingServer: false
	},
	use: { baseURL: 'http://localhost:4180' }
});
