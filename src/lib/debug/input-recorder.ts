/**
 * Records one editor's input as an `aragonite-input-recording/1` file. Capture-phase listeners on
 * the editor's root (plus `selectionchange` on `document`, filtered to the root) only read: they
 * never prevent or stop an event. Every listener shares one abort signal, so a stopped recording
 * holds none (G1.116).
 */

import { hashSource } from '../core/string-hash';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import type { EditorSelection } from '../selection/primitives';
import { ARAGONITE_VERSION } from '../version';
import {
	INPUT_RECORDING_FORMAT,
	classifyStep,
	isModifierKeydown,
	spliceBetween,
	type InputRecording,
	type RecordedEvent,
	type RecordedRange,
	type RecordedState,
	type RecordedStep,
	type RecordingEnvironment
} from './input-recording';

export interface InputRecorderDeps {
	root(): HTMLElement | null;
	getSource(): string;
	getSelection(): EditorSelection | null;
	contentVersion(): number;
	presentationMode(): string;
	caret(): string;
	/** A live DOM position as block path and raw offset, or null outside any block. */
	rawPoint(node: Node, offset: number): { path: number[]; offset: number } | null;
}

export interface InputRecordingOptions {
	/** Keep typed characters, key codes, event data, clipboard and DOM text. Off by default. */
	includeText?: boolean;
}

export interface InputRecordingHandle {
	/** Ends the recording and returns it; a second call returns the same recording. */
	stop(): InputRecording;
}

const ROOT_EVENTS = [
	'keydown',
	'keyup',
	'beforeinput',
	'input',
	'compositionstart',
	'compositionupdate',
	'compositionend',
	'paste',
	'drop',
	'pointerdown',
	'pointerup'
] as const;

// The events whose DOM text and selection a replay without a real keyboard would need.
const DOM_READ_EVENTS = new Set([
	'beforeinput',
	'input',
	'compositionstart',
	'compositionupdate',
	'compositionend'
]);

interface OpenStep {
	opener: string;
	before: RecordedState;
	events: RecordedEvent[];
	/** The live events, so each verdict is read once its dispatch is long over. */
	live: Event[];
}

export function startInputRecording(
	deps: InputRecorderDeps,
	options: InputRecordingOptions = {}
): InputRecordingHandle {
	const includeText = options.includeText ?? false;
	// Without text, a hash anyone can recompute would give back each typed character by guessing.
	const salt = includeText ? '' : Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
	const hash = (source: string) => hashSource(salt + source);
	const controller = new AbortController();
	const steps: RecordedStep[] = [];
	let lastVersion = deps.contentVersion();
	let lastSource = deps.getSource();
	let lastHash = hash(lastSource);
	let lastTime = performance.now();
	// The source when the open step began, which its splice is measured against.
	let previousSource = lastSource;
	let current: OpenStep | null = null;
	let composing = false;
	let result: InputRecording | null = null;

	const initial = {
		...(includeText ? { source: lastSource } : {}),
		hash: lastHash,
		selection: deps.getSelection()
	};

	// The source is read again only when the version moved, so a caret-only step costs no copy.
	function snapshot(): RecordedState & { source: string } {
		const version = deps.contentVersion();
		if (version !== lastVersion) {
			lastVersion = version;
			lastSource = deps.getSource();
			lastHash = hash(lastSource);
		}
		return { version, hash: lastHash, selection: deps.getSelection(), source: lastSource };
	}

	function closeStep(): void {
		if (!current) return;
		const now = snapshot();
		current.events.forEach((event, i) => (event.verdict = current!.live[i].defaultPrevented));
		const [from, to, inserted] = spliceBetween(previousSource, now.source);
		steps.push({
			family: classifyStep(current.opener, current.events),
			before: current.before,
			after: {
				version: now.version,
				hash: now.hash,
				selection: now.selection,
				splice: [from, to, keepText(inserted)]
			},
			events: current.events
		});
		current = null;
	}

	function openStep(opener: string): void {
		closeStep();
		const { source, ...before } = snapshot();
		previousSource = source;
		current = { opener, before, events: [], live: [] };
	}

	function onEvent(event: Event): void {
		assertInvariant('recorder-listener-after-stop', () =>
			result
				? {
						code: 'recorder-listener-after-stop',
						message: 'an input recorder listener ran after its recording stopped'
					}
				: null
		);
		if (result) return;
		if (event.type === 'selectionchange' && !selectionInRoot()) return;
		const opener = stepOpener(event);
		if (opener) openStep(opener);
		if (event.type === 'compositionstart') composing = true;
		if (event.type === 'compositionend') composing = false;
		if (!current) return;
		current.events.push(describe(event));
		current.live.push(event);
	}

	// Which event starts a new step rather than joining the open one; null joins.
	function stepOpener(event: Event): string | null {
		const open = current;
		const sawInput = open?.events.some((e) => e.type === 'beforeinput') ?? false;
		switch (event.type) {
			case 'keydown': {
				const e = event as KeyboardEvent;
				if (composing || e.isComposing) return null;
				const onlyModifiers =
					open?.opener === 'keydown' && !sawInput && open.events.every(isModifierKeydown);
				return onlyModifiers ? null : 'keydown';
			}
			case 'compositionstart': {
				// Only the IME's own keydown starts a composition; any other key was a step of its own.
				const imeKey = open?.events.findLast((e) => e.type === 'keydown');
				const opened = imeKey?.keyCode === 229 || imeKey?.key === 'Process';
				return open?.opener === 'keydown' && !sawInput && opened ? null : 'compositionstart';
			}
			case 'beforeinput': {
				if (composing || open?.opener === 'paste' || open?.opener === 'drop') return null;
				const keyed = open?.opener === 'keydown' || open?.opener === 'beforeinput';
				return keyed && !sawInput ? null : 'beforeinput';
			}
			case 'paste':
			case 'drop': {
				const chord =
					open?.opener === 'keydown' &&
					!sawInput &&
					open.events.some((e) => e.type === 'keydown' && /[CM]/.test(e.mods ?? ''));
				return chord ? null : event.type;
			}
			case 'pointerdown':
				return 'pointerdown';
			default:
				return null;
		}
	}

	function selectionInRoot(): boolean {
		const node = document.getSelection()?.anchorNode;
		return !!node && !!deps.root()?.contains(node);
	}

	function describe(event: Event): RecordedEvent {
		const now = performance.now();
		const rec: RecordedEvent = {
			type: event.type,
			dt: Math.round(now - lastTime),
			trusted: event.isTrusted
		};
		lastTime = now;
		if (event instanceof KeyboardEvent) Object.assign(rec, describeKey(event, includeText));
		if (event instanceof InputEvent) {
			rec.inputType = event.inputType;
			rec.isComposing = event.isComposing;
			rec.data = keepText(event.data);
			if (event.type === 'beforeinput') rec.targetRanges = targetRanges(event);
		}
		if (event instanceof CompositionEvent) rec.data = keepText(event.data);
		if (event.type === 'paste' || event.type === 'drop') {
			rec.clipboard = transferContents(event as ClipboardEvent & DragEvent);
		}
		if (event.type === 'pointerdown' || event.type === 'pointerup') {
			rec.pointerType = (event as PointerEvent).pointerType;
		}
		if (DOM_READ_EVENTS.has(event.type) || event.type === 'selectionchange') {
			const surface = editableOf(event.target) ?? editableOf(document.getSelection()?.anchorNode);
			// A selection change moves no text, so only the input events carry it.
			const withText = includeText && surface && event.type !== 'selectionchange';
			rec.dom = {
				...(withText ? { text: surface.textContent ?? '' } : {}),
				sel: surface ? selectionTextOffsets(surface) : null
			};
		}
		return rec;
	}

	function keepText<T extends string | null>(text: T): T | number {
		return text === null || includeText ? text : text.length;
	}

	function transferContents(event: ClipboardEvent & DragEvent): Record<string, string | number> {
		const data = event.clipboardData ?? event.dataTransfer;
		const out: Record<string, string | number> = {};
		for (const type of data?.types ?? []) {
			if (type === 'Files') {
				out.Files = data?.files.length ?? 0;
				continue;
			}
			out[type] = keepText(data?.getData(type) ?? '');
		}
		return out;
	}

	function targetRanges(event: InputEvent): RecordedRange[] {
		const surface = editableOf(event.target);
		return (event.getTargetRanges?.() ?? []).map((range) => {
			const start = deps.rawPoint(range.startContainer, range.startOffset);
			const end = deps.rawPoint(range.endContainer, range.endOffset);
			return {
				raw: start && end ? [start.path, start.offset, end.path, end.offset] : null,
				dom: [
					surface ? textOffset(surface, range.startContainer, range.startOffset) : -1,
					surface ? textOffset(surface, range.endContainer, range.endOffset) : -1
				]
			};
		});
	}

	function environment(): RecordingEnvironment {
		const nav = navigator as Navigator & {
			userAgentData?: {
				platform: string;
				mobile: boolean;
				brands: { brand: string; version: string }[];
			};
		};
		const ua = nav.userAgentData;
		const matches = (query: string) =>
			typeof matchMedia === 'function' && matchMedia(query).matches;
		const pointer = matches('(pointer: coarse)')
			? 'coarse'
			: matches('(pointer: fine)')
				? 'fine'
				: 'none';
		return {
			userAgent: nav.userAgent,
			uaData: ua
				? {
						platform: ua.platform,
						mobile: ua.mobile,
						brands: ua.brands.map((b) => `${b.brand} ${b.version}`)
					}
				: null,
			pointer,
			viewport: [innerWidth, innerHeight],
			dpr: devicePixelRatio
		};
	}

	const root = deps.root();
	const listen = { capture: true, passive: true, signal: controller.signal };
	if (root) for (const type of ROOT_EVENTS) root.addEventListener(type, onEvent, listen);
	document.addEventListener('selectionchange', onEvent, listen);

	return {
		stop() {
			if (result) return result;
			closeStep();
			controller.abort();
			result = {
				format: INPUT_RECORDING_FORMAT,
				editor: {
					version: ARAGONITE_VERSION,
					presentationMode: deps.presentationMode(),
					caret: deps.caret()
				},
				text: includeText,
				env: environment(),
				initial,
				steps,
				expected: steps.map((step) => ({ hash: step.after.hash, selection: step.after.selection }))
			};
			return result;
		}
	};
}

// ── DOM reads ───────────────────────────────────────────────────────────────

function describeKey(event: KeyboardEvent, includeText: boolean): Partial<RecordedEvent> {
	const mods =
		(event.ctrlKey ? 'C' : '') +
		(event.metaKey ? 'M' : '') +
		(event.altKey ? 'A' : '') +
		(event.shiftKey ? 'S' : '');
	// A Ctrl or Cmd chord types nothing, but AltGr reports itself as Ctrl+Alt and does type.
	const chord = (event.ctrlKey || event.metaKey) && !event.altKey;
	// A named key's code and keyCode still spell the letter under an IME's `Process` or a dead key.
	const keepCode = includeText || chord;
	return {
		...(keepCode || isNamedKey(event.key) ? { key: event.key } : {}),
		...(keepCode ? { code: event.code } : {}),
		...(keepCode || event.keyCode === 229 ? { keyCode: event.keyCode } : {}),
		mods,
		repeat: event.repeat,
		isComposing: event.isComposing
	};
}

/** `Enter`, `ArrowLeft`, `F5`, `Process`: a key name that spells no typed character. */
function isNamedKey(key: string): boolean {
	return /^[A-Z][A-Za-z0-9]+$/.test(key);
}

function editableOf(target: EventTarget | Node | null | undefined): HTMLElement | null {
	const node = target as Node | null | undefined;
	const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null);
	return (el?.closest?.('[contenteditable="true"]') as HTMLElement | null) ?? null;
}

function textOffset(surface: HTMLElement, node: Node, offset: number): number {
	const range = document.createRange();
	range.selectNodeContents(surface);
	try {
		range.setEnd(node, offset);
	} catch {
		return -1;
	}
	return range.toString().length;
}

function selectionTextOffsets(surface: HTMLElement): [number, number] | null {
	const sel = document.getSelection();
	if (!sel?.anchorNode || !sel.focusNode || !surface.contains(sel.anchorNode)) return null;
	return [
		textOffset(surface, sel.anchorNode, sel.anchorOffset),
		textOffset(surface, sel.focusNode, sel.focusOffset)
	];
}
