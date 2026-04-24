/**
 * DEV-mode diagnostic warning. Suppressed under Vitest (VITEST env var) so
 * tests that exercise error paths don't flood the console.
 */
declare const process: { env?: Record<string, string | undefined> } | undefined;

export function devWarn(tag: string, message: string, details?: unknown): void {
	if (!import.meta.env.DEV) return;
	if (typeof process !== 'undefined' && process?.env?.VITEST) return;
	if (details !== undefined) {
		console.warn(`[${tag}] ${message}`, details);
	} else {
		console.warn(`[${tag}] ${message}`);
	}
}
