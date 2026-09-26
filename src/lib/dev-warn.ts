import { editorEnv } from './env';

export interface DevWarnEntry {
	tag: string;
	message: string;
	details?: unknown;
}

export type DevWarnSink = (entry: DevWarnEntry) => void;

let sink: DevWarnSink | null = null;

/**
 * Tags every warning watcher prints and never fails on, to list each place a behavior happens
 * before the editor refuses it. The reading-mode write check reports through one until then (#493).
 */
export const CENSUS_WARN_TAGS: readonly string[] = ['reading-write'];

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

const EDITOR_TAG = /\[aragonite:([^\]]+)\]/;

/** Svelte's runtime warnings lead with their code, after any `%c` styling. */
const SVELTE_CODE = /\[svelte\]\s+([a-z0-9_]+)/;

/**
 * The tag a console line carries: the editor's own, or `svelte:<code>` for a Svelte runtime
 * warning, so one waiver list covers both; null for any other line. Every warning watcher reads
 * lines through here.
 */
export function warnTagOfLine(text: string): string | null {
	const tag = EDITOR_TAG.exec(text)?.[1];
	if (tag) return tag;
	const code = SVELTE_CODE.exec(text)?.[1];
	return code ? `svelte:${code}` : null;
}
