/**
 * Content-keyed, pre-parse paste transforms: a plugin registers a named transform that
 * rewrites the raw clipboard text or declines. Register-once, throw-on-duplicate — the
 * `customElements` model shared with `paste-surfaces.ts`.
 */
import type { PluginActivation } from '../../schema/plugin-activation';
import { currentInstallingPlugin } from '../../schema/plugin-install';
import { registerOnce } from '../../schema/register-once';
import { devWarn } from '../../dev-warn';
import { editorEnv } from '../../env';

export interface PasteTransform {
	/** Unique across the process; a duplicate registration throws. */
	readonly name: string;
	/** A replacement for `text`, or null to decline. A throw is contained as a decline. */
	transform(text: string): string | null;
}

interface RegisteredTransform {
	transform: PasteTransform;
	owner: string | null;
}

// Map iteration is insertion order, so `.values()` is the pipeline order while the keyed
// lookup guards duplicates — one structure, no parallel array.
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
 * Non-throwing registration probe, so an idempotent module (HMR, a re-imported registrar) asks
 * before registering instead of catching the duplicate throw.
 */
export function isPasteTransformRegistered(name: string): boolean {
	return transforms.has(name);
}

/**
 * Run every transform over `text` in registration order, each seeing the prior's output;
 * a null return leaves the running text untouched. `activation` scopes the run to one
 * instance's plugins; absent = every installed one. A transform no plugin owns always runs.
 */
export function applyPasteTransforms(text: string, activation?: PluginActivation): string {
	if (transforms.size === 0) return text;
	let result = text;
	for (const { transform, owner } of transforms.values()) {
		if (owner !== null && activation && !activation.isActive(owner)) continue;
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
 * The one door plugin `transform()` code is called through. On the cross-block route the
 * covering range delete has already committed, so an escaping throw would leave the
 * selection deleted and nothing pasted; a throw becomes the null a decline returns. The
 * warning names its phase because a probe-time throw read as a decline would send the
 * author debugging a paste that worked.
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

// A transform whose own output feeds back into a further rewrite drives a paste feedback
// loop, so in dev it is re-run on its result: it must decline or reproduce it.
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
