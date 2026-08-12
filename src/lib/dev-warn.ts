import { editorEnv } from './env';

export interface DevWarnEntry {
	tag: string;
	message: string;
	details?: unknown;
}

export type DevWarnSink = (entry: DevWarnEntry) => void;

let sink: DevWarnSink | null = null;

/**
 * Route fires to `next` instead of the console, and return the sink it replaced. For a
 * harness that must read fires structurally; runner-agnostic by contract, so nothing here
 * may know about a test runner. Nothing registers one in production or on a dev server.
 */
export function setDevWarnSink(next: DevWarnSink | null): DevWarnSink | null {
	const previous = sink;
	sink = next;
	return previous;
}

export function devWarn(tag: string, message: string, details?: unknown): void {
	if (!editorEnv.isDev) return;
	if (sink) {
		sink({ tag, message, details });
		return;
	}
	if (details !== undefined) {
		console.warn(`[${tag}] ${message}`, details);
	} else {
		console.warn(`[${tag}] ${message}`);
	}
}
