/**
 * The `registerInlineSyntax` registrar: plugin inline syntax handlers, each a trigger character plus
 * an optional longer prefix, consulted lowest priority first. Its records feed each editor's inline
 * table (`inline-table.ts`), which is what the parse reads.
 */
import type { ImageSyntaxRewriter, InlineNode } from '../../nodes';
import type { GrammarView } from '../../../schema/block-openers';
import { createPluginRegistry } from '../../../schema/plugin-registry';

/**
 * Inspect `raw` at `pos` (the trigger) within `[pos, end)`. Return a node with `start === pos`
 * and `pos < node.end <= end` to claim that span (`node.end` is the scan advance), or `null` to
 * leave the trigger literal. `end` bounds the search too: `raw` is the whole block while the
 * range may be a slice of it, so a terminator past `end` must decline. Claiming past it throws.
 */
export type InlineSyntaxRecognizer = (raw: string, pos: number, end: number) => InlineNode | null;

/** The priority numbers registrations use; lower is consulted first. */
export const INLINE_PRIORITIES = {
	/** Handlers consulted before a reserved trigger's built-in handling. */
	prefixOverride: 40,
	/** The built-in handler's own place in the order; not registerable. */
	builtin: 50,
	/** Default for bare-trigger registrations. */
	plugin: 100
} as const;

export interface InlineSyntaxOptions {
	/** Two or more characters starting with the trigger; required for a reserved trigger, where it
	 *  runs before the built-in handler, so decline a built-in construct it also opens. */
	prefix?: string;
	/** Lower is consulted first. Defaults to `INLINE_PRIORITIES.plugin`. */
	priority?: number;
	/** Re-serializes the `image` nodes this recognizer creates; without it the editor refuses
	 *  their edits rather than write GFM over your syntax. Return `null` for what it can't hold. */
	rewriteImage?: ImageSyntaxRewriter;
	/** Typing the trigger (`$…$`) inserts its closer after the caret, so the opener pairs with it
	 *  rather than a later formula's delimiter. Bare triggers only. */
	autoPair?: boolean;
}

/** The parse hands its grammar on as a fourth argument, which only the core text directive reads. */
export type ScopedRecognizer = (
	raw: string,
	pos: number,
	end: number,
	grammar: GrammarView
) => InlineNode | null;

export interface InlineHandler {
	prefix: string;
	priority: number;
	recognizer: ScopedRecognizer;
	rewriteImage?: ImageSyntaxRewriter;
	/** The plugin whose setup registered the handler; null for a core one. */
	owner: string | null;
}

/** A handler as an inline table holds it: its trigger, and whether typing the trigger pairs it. */
export interface HandlerRecord {
	trigger: string;
	autoPair: boolean;
	handler: InlineHandler;
}

interface Registration extends Omit<InlineHandler, 'owner'> {
	trigger: string;
	autoPair: boolean;
}

const BUILT_IN_TRIGGERS = new Set(['\\', '`', '&', '\n', '*', '_', '~', '[', ']', '!', '<']);

const registrations = createPluginRegistry<string, Registration>({
	label: 'registerInlineSyntax',
	isBuiltin: () => false,
	onChange: rebuild
});

// Derived from the registrations on every change, so a table reads them without a copy per read.
let records: readonly HandlerRecord[] = [];
let version = 0;

function rebuild(): void {
	records = registrations.records().map(({ value, owner }) => {
		const { trigger, autoPair, ...handler } = value;
		return { trigger, autoPair, handler: { ...handler, owner } };
	});
	version++;
}

/** The order the parse asks handlers on one character in: lower priority, then the longer
 *  prefix, then the prefix itself. */
export function byHandlerOrder(a: InlineHandler, b: InlineHandler): number {
	return (
		a.priority - b.priority ||
		b.prefix.length - a.prefix.length ||
		(a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0)
	);
}

export function registerInlineSyntax(
	trigger: string,
	recognizer: InlineSyntaxRecognizer,
	options?: InlineSyntaxOptions
): void {
	const { prefix, priority = INLINE_PRIORITIES.plugin, rewriteImage, autoPair } = options ?? {};
	const refuse = (why: string) => {
		throw new Error(`registerInlineSyntax: ${why}`);
	};
	const quoted = JSON.stringify;
	if (trigger.length !== 1) refuse(`trigger ${quoted(trigger)} is not one UTF-16 unit`);
	if (prefix !== undefined && (prefix.length < 2 || !prefix.startsWith(trigger))) {
		refuse(`prefix ${quoted(prefix)} is not ${quoted(trigger)} plus more`);
	}
	if (trigger === ']') refuse(`trigger "]" can never be reached`);
	if (isBuiltInTrigger(trigger)) {
		if (prefix === undefined) refuse(`trigger ${quoted(trigger)} is built in and needs a prefix`);
		if (priority >= INLINE_PRIORITIES.builtin) {
			refuse(
				`priority ${priority} on built-in trigger ${quoted(trigger)} is not below the built-in reading`
			);
		}
	}
	if (autoPair && prefix !== undefined) refuse(`autoPair cannot go with prefix ${quoted(prefix)}`);
	const effectivePrefix = prefix ?? trigger;
	registrations.register(
		quoted([trigger, effectivePrefix, priority]),
		{
			trigger,
			prefix: effectivePrefix,
			priority,
			recognizer: recognizer as ScopedRecognizer,
			...(rewriteImage ? { rewriteImage } : {}),
			autoPair: autoPair ?? false
		},
		`registerInlineSyntax: ${quoted(effectivePrefix)} at priority ${priority} is already registered`
	);
}

/** Every registration, unfiltered, for an inline table to filter by its editor's plugins. */
export const registeredHandlers = (): readonly HandlerRecord[] => records;

/** Every registered handler on `trigger`, whatever plugin it answers to, in the parse's order. */
export const handlersFor = (trigger: string): readonly InlineHandler[] =>
	records
		.filter((record) => record.trigger === trigger)
		.map((record) => record.handler)
		.sort(byHandlerOrder);

/** Bumped on every registry change, so a table can cache what it derives from the registry. */
export const registryVersion = () => version;

export const isBuiltInTrigger = (char: string) => BUILT_IN_TRIGGERS.has(char);
