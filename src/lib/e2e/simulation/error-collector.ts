import type { Page } from '@playwright/test';

export interface ErrorCollector {
	assertNone(): void;
}

/**
 * No global console/pageerror gate exists in the harness, so a long session
 * owns its own. Attach at session start (before any gesture) so nothing fires
 * unobserved; `assertNone` is called at checkpoints and at the end.
 */
export function attachErrorCollector(page: Page): ErrorCollector {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
	});
	return {
		assertNone() {
			if (errors.length) {
				throw new Error(`Console/page errors during session:\n${errors.join('\n')}`);
			}
		}
	};
}
