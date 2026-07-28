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
	/** Return a replacement for `text`, or null to decline ("not mine"). A throw
	 *  is contained and read as a decline. */
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
		const next = runContained(transform, result, 'pipeline');
		if (next === null) continue;
		warnIfNonIdempotent(transform, next);
		result = next;
	}
	return result;
}

export function __resetPasteTransformsForTests(): void {
	transforms.clear();
}

/**
 * The one door `transform()` (plugin code, run on a user gesture) is called
 * through. On the cross-block route the covering range delete has already
 * committed by the time the pipeline runs, so an escaping throw leaves the
 * selection deleted, nothing pasted, and the consumer's error seam silent. A
 * throw becomes the same null a decline returns, which also keeps the dev probe
 * below honest: a re-run that throws reads as "declined", so it can never be
 * misreported as a non-idempotent rewrite. The phase is named in the warning
 * because the two sites cost the author different things, and a probe-time
 * throw reported as a decline would send them debugging a paste that worked.
 */
function runContained(
	transform: PasteTransform,
	text: string,
	phase: 'pipeline' | 'probe'
): string | null {
	try {
		return transform.transform(text);
	} catch (error) {
		const outcome =
			phase === 'pipeline'
				? 'in the paste pipeline; declining, so the running text is untouched'
				: 'in the dev idempotence probe; the paste keeps its first result';
		devWarn('paste-transform', `transform '${transform.name}' threw ${outcome}`, error);
		return null;
	}
}

// A transform whose own output feeds back into a further rewrite drives a paste
// feedback loop. In dev, re-run the firing transform on its result: it must
// decline or reproduce it. The extra call is dev-only, so production never pays.
function warnIfNonIdempotent(transform: PasteTransform, result: string): void {
	if (!editorEnv.isDev) return;
	const again = runContained(transform, result, 'probe');
	if (again !== null && again !== result) {
		devWarn(
			'paste-transform',
			`transform '${transform.name}' is not idempotent — re-running it on its own output changed the text again`
		);
	}
}
