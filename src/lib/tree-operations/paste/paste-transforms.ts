/**
 * Content-keyed, pre-parse paste transforms. A plugin registers a named
 * transform that inspects the raw clipboard text and either rewrites it or
 * declines; `applyPasteTransforms` runs the whole pipeline at the two sites
 * where clipboard text reaches `parse()`. Register-once, throw-on-duplicate —
 * the `customElements` model shared with `paste-surfaces.ts`.
 */
import { currentInstallingPlugin } from '../../schema/plugin-install';
import { registerOnce } from '../../schema/register-once';
import { devWarn } from '../../dev-warn';
import { editorEnv } from '../../env';

export interface PasteTransform {
	/** Unique across the process; a duplicate registration throws. */
	readonly name: string;
	/** Return a replacement for `text`, or null to decline ("not mine"). */
	transform(text: string): string | null;
}

interface RegisteredTransform {
	transform: PasteTransform;
	owner: string | null;
}

// Map iteration is insertion order, so `.values()` is the pipeline order and the
// keyed lookup guards duplicates — one structure, no parallel array.
const transforms = new Map<string, RegisteredTransform>();

export function registerPasteTransform(transform: PasteTransform): void {
	const existing = transforms.get(transform.name);
	registerOnce(
		existing !== undefined,
		() => transforms.set(transform.name, { transform, owner: currentInstallingPlugin() }),
		`registerPasteTransform: "${transform.name}" is already registered` +
			(existing?.owner ? ` by plugin '${existing.owner}'` : '') +
			`. Paste transforms are register-once.`
	);
}

/**
 * Run every registered transform over `text` in registration order — each sees
 * the prior transform's output; a null return leaves the running text untouched.
 * The empty registry returns the input with no allocation (paste's hot path).
 */
export function applyPasteTransforms(text: string): string {
	if (transforms.size === 0) return text;
	let result = text;
	for (const { transform } of transforms.values()) {
		const next = transform.transform(result);
		if (next === null) continue;
		warnIfNonIdempotent(transform, next);
		result = next;
	}
	return result;
}

export function __resetPasteTransformsForTests(): void {
	transforms.clear();
}

// A transform whose own output feeds back into a further rewrite drives a paste
// feedback loop. In dev, re-run the firing transform on its result: it must
// decline or reproduce it. The extra call is dev-only, so production never pays.
function warnIfNonIdempotent(transform: PasteTransform, result: string): void {
	if (!editorEnv.isDev) return;
	const again = transform.transform(result);
	if (again !== null && again !== result) {
		devWarn(
			'paste-transform',
			`transform '${transform.name}' is not idempotent — re-running it on its own output changed the text again`
		);
	}
}
