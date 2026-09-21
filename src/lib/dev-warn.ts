import { editorEnv } from './env';

export interface DevWarnEntry {
	tag: string;
	message: string;
	details?: unknown;
}

export type DevWarnSink = (entry: DevWarnEntry) => void;

let sink: DevWarnSink | null = null;

/**
 * Send warnings to `next` instead of the console, and return the callback it replaced. For
 * a harness that needs to read them as data; it must work with any runner, so nothing here
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
	// The `aragonite:` prefix is what the e2e watchers key on: a console prefix no page
	// script or dependency shares, so a browser-side check can fail on ours alone.
	if (details !== undefined) {
		console.warn(`[aragonite:${tag}] ${message}`, details);
	} else {
		console.warn(`[aragonite:${tag}] ${message}`);
	}
}
