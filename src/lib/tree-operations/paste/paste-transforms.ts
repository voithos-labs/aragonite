/**
 * Content-keyed, pre-parse paste transforms: a plugin registers a named transform that
 * rewrites the raw clipboard text or declines. Register-once, throw-on-duplicate, the
 * `customElements` model shared with `paste-surfaces.ts`.
 */
import type { PluginActivation } from '../../schema/plugin-activation';
import { createPluginRegistry } from '../../schema/plugin-registry';
import { devWarn } from '../../dev-warn';
import { editorEnv } from '../../env';

export interface PasteTransform {
	/** Unique across the process; a duplicate registration throws. */
	readonly name: string;
	/** A replacement for `text`, or null to decline. A throw is contained as a decline. */
	transform(text: string): string | null;
}

// Registration order is the pipeline order.
const transforms = createPluginRegistry<string, PasteTransform>({
	label: 'registerPasteTransform',
	isBuiltin: () => false
});

export function registerPasteTransform(transform: PasteTransform): void {
	const owner = transforms.ownerOf(transform.name);
	transforms.register(
		transform.name,
		transform,
		`registerPasteTransform: "${transform.name}" is already registered` +
			(owner ? ` by plugin '${owner}'` : '') +
			`. Paste transforms are register-once.`
	);
}

/**
 * Non-throwing registration check, so an idempotent module (HMR, a re-imported registrar) asks
 * before registering instead of catching the duplicate throw.
 */
export function isPasteTransformRegistered(name: string): boolean {
	return transforms.has(name);
}

/**
 * Run every transform `activation` resolves over `text` in registration order, each seeing the
 * prior's output; a null return leaves the running text untouched.
 */
export function applyPasteTransforms(text: string, activation: PluginActivation): string {
	let result = text;
	for (const [, transform] of transforms.entries(activation)) {
		const next = runContained(transform, result, 'pipeline');
		if (next === null) continue;
		warnIfNonIdempotent(transform, next);
		result = next;
	}
	return result;
}

/**
 * The one place plugin `transform()` code is called from. A throw becomes a decline, since on the
 * cross-block route the range delete has already committed and an escaping throw would leave the
 * selection deleted and nothing pasted. The warning names its phase, the dev re-run or the paste.
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
			`transform '${transform.name}' is not idempotent: re-running it on its own output changed the text again`
		);
	}
}
