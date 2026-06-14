import { editorEnv } from './env';

export function devWarn(tag: string, message: string, details?: unknown): void {
	if (!editorEnv.isDev || editorEnv.isTest) return;
	if (details !== undefined) {
		console.warn(`[${tag}] ${message}`, details);
	} else {
		console.warn(`[${tag}] ${message}`);
	}
}
