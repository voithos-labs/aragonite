// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { startInputRecording, type InputRecorderDeps } from '#lib/debug/input-recorder.js';
import type { InputRecording } from '#lib/debug/input-recording.js';
import { hashSource } from '#lib/core/string-hash.js';

// Miss-analysis: new module; these rows pin its privacy rule, its step boundaries and its
// listener lifetime, none of which a replay through the editor would notice breaking.

const SECRET_DOC = 'Dear diary, the launch code is 0451\n';

function fixture() {
	const root = document.createElement('div');
	const editable = document.createElement('div');
	editable.setAttribute('contenteditable', 'true');
	editable.textContent = 'Dear diary';
	root.append(editable);
	document.body.append(root);
	let source = SECRET_DOC;
	let version = 0;
	const deps: InputRecorderDeps = {
		root: () => root,
		getSource: () => source,
		getSelection: () => ({ anchor: { path: [0], offset: 3 }, focus: { path: [0], offset: 3 } }),
		contentVersion: () => version,
		presentationMode: () => 'source',
		caret: () => 'auto',
		rawPoint: () => ({ path: [0], offset: 3 })
	};
	const write = (next: string) => {
		source = next;
		version++;
	};
	return { root, editable, deps, write };
}

function key(target: EventTarget, type: string, init: KeyboardEventInit) {
	target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, ...init }));
}

function input(target: EventTarget, type: string, init: InputEventInit) {
	target.dispatchEvent(new InputEvent(type, { bubbles: true, ...init }));
}

function paste(target: EventTarget, text: string) {
	const event = new Event('paste', { bubbles: true });
	const clipboardData = {
		types: ['text/plain'],
		getData: () => text,
		files: []
	};
	Object.defineProperty(event, 'clipboardData', { value: clipboardData });
	target.dispatchEvent(event);
}

afterEach(() => {
	document.body.innerHTML = '';
	vi.restoreAllMocks();
});

describe('a recording without text', () => {
	it('holds no document text, typed character, key code, event data or clipboard text', () => {
		const { editable, deps, write } = fixture();
		const handle = startInputRecording(deps);
		key(editable, 'keydown', { key: 'q', code: 'KeyQ', keyCode: 81 });
		input(editable, 'beforeinput', { inputType: 'insertText', data: 'q' });
		write('Dear diaryq, the launch code is 0451\n');
		key(editable, 'keydown', { key: 'Enter', code: 'Enter', keyCode: 13 });
		paste(editable, 'zebra-crossing');
		const json = JSON.stringify(handle.stop());

		for (const text of ['Dear', 'diary', '0451', 'zebra', '"q"', 'KeyQ', ':81']) {
			expect(json).not.toContain(text);
		}
		// Named keys and lengths stay, so the recording still says what happened.
		expect(json).toContain('"key":"Enter"');
		expect(json).toContain('"text/plain":14');
	});

	// Miss-analysis: the privacy row typed only an unchorded letter, so AltGr's Ctrl+Alt and an
	// IME keydown's physical code, both of which spell typed text, never reached it.
	it('drops a character typed through AltGr and the physical key under an IME keydown', () => {
		const { editable, deps } = fixture();
		const handle = startInputRecording(deps);
		key(editable, 'keydown', { key: 'ł', code: 'KeyL', keyCode: 76, ctrlKey: true, altKey: true });
		key(editable, 'keydown', { key: 'Process', code: 'KeyK', keyCode: 229 });
		const json = JSON.stringify(handle.stop());

		for (const text of ['ł', 'KeyL', ':76', 'KeyK']) expect(json).not.toContain(text);
		expect(json).toContain('"key":"Process"');
	});

	// Miss-analysis: the privacy row searched the file for the document's words, never for a hash
	// a reader can recompute from a guessed document.
	it('leaves no hash a guessed document and a typed character would reproduce', () => {
		const { editable, deps, write } = fixture();
		const handle = startInputRecording(deps);
		key(editable, 'keydown', { key: 'q' });
		write('Dear diaryq, the launch code is 0451\n');
		const json = JSON.stringify(handle.stop());

		expect(json).not.toContain(hashSource(SECRET_DOC));
		expect(json).not.toContain(hashSource('Dear diaryq, the launch code is 0451\n'));
	});

	it('keeps all of it with includeText', () => {
		const { editable, deps } = fixture();
		const handle = startInputRecording(deps, { includeText: true });
		key(editable, 'keydown', { key: 'q', code: 'KeyQ', keyCode: 81 });
		input(editable, 'beforeinput', { inputType: 'insertText', data: 'q' });
		paste(editable, 'zebra-crossing');
		const json = JSON.stringify(handle.stop());

		for (const text of ['launch code', '"key":"q"', 'KeyQ', '"data":"q"', 'zebra-crossing']) {
			expect(json).toContain(text);
		}
	});
});

describe('step boundaries', () => {
	function families(record: (editable: HTMLElement) => void): string[] {
		const { editable, deps } = fixture();
		const handle = startInputRecording(deps);
		record(editable);
		return handle.stop().steps.map((s) => s.family);
	}

	it('joins a chord to its modifier and its paste to the chord', () => {
		expect(
			families((el) => {
				key(el, 'keydown', { key: 'Control', ctrlKey: true });
				key(el, 'keydown', { key: 'v', ctrlKey: true });
				paste(el, 'x');
				input(el, 'beforeinput', { inputType: 'insertFromPaste' });
			})
		).toEqual(['paste']);
	});

	it('opens a step for each keyboard-less insert, and keeps a composition in one', () => {
		expect(
			families((el) => {
				input(el, 'beforeinput', { inputType: 'insertText', data: 'a' });
				input(el, 'beforeinput', { inputType: 'insertReplacementText', data: 'b' });
				key(el, 'keydown', { key: 'Process', keyCode: 229 });
				el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
				key(el, 'keydown', { key: 'n', keyCode: 229, isComposing: true });
				el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'x' }));
				key(el, 'keydown', { key: 'Enter' });
			})
		).toEqual(['text', 'rewrite', 'composition', 'key']);
	});

	// Miss-analysis: the boundary rows only composed after an IME keydown; the probe session caught it.
	it('opens a composition of its own after a key the editor handled at keydown', () => {
		expect(
			families((el) => {
				key(el, 'keydown', { key: 'Backspace' });
				el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
				el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'x' }));
			})
		).toEqual(['key', 'composition']);
	});

	it("chains each step's bytes to the next, with the splice between", () => {
		const { editable, deps, write } = fixture();
		const handle = startInputRecording(deps, { includeText: true });
		key(editable, 'keydown', { key: 'x' });
		write('Dear diaryx, the launch code is 0451\n');
		key(editable, 'keydown', { key: 'Backspace' });
		const recording: InputRecording = handle.stop();

		expect(recording.steps[0].after.splice).toEqual([10, 10, 'x']);
		expect(recording.steps[1].before.hash).toBe(recording.steps[0].after.hash);
		expect(recording.expected).toHaveLength(2);
	});

	it("reads each event's verdict once its step closes", () => {
		const { editable, deps } = fixture();
		editable.addEventListener('keydown', (e) => e.preventDefault());
		const handle = startInputRecording(deps);
		key(editable, 'keydown', { key: 'Enter', cancelable: true });
		expect(handle.stop().steps[0].events[0].verdict).toBe(true);
	});
});

describe('the listeners', () => {
	it('are all gone once the recording stops (G1.116)', () => {
		const { root, editable, deps } = fixture();
		const added: AddEventListenerOptions[] = [];
		for (const target of [root, document]) {
			const real = target.addEventListener.bind(target);
			vi.spyOn(target, 'addEventListener').mockImplementation((type, fn, options) => {
				added.push(options as AddEventListenerOptions);
				real(type, fn, options);
			});
		}
		const handle = startInputRecording(deps);
		const recording = handle.stop();
		key(editable, 'keydown', { key: 'Enter' });
		document.dispatchEvent(new Event('selectionchange'));

		expect(added.length).toBeGreaterThan(0);
		expect(added.every((options) => options.signal?.aborted)).toBe(true);
		expect(recording.steps).toEqual([]);
		expect(handle.stop()).toBe(recording);
	});

	it('belong to their own recording, so two run side by side', () => {
		const { editable, deps } = fixture();
		const first = startInputRecording(deps);
		key(editable, 'keydown', { key: 'Enter' });
		const second = startInputRecording(deps);
		key(editable, 'keydown', { key: 'Tab' });
		expect(first.stop().steps).toHaveLength(2);
		key(editable, 'keydown', { key: 'Escape' });
		expect(second.stop().steps).toHaveLength(2);
	});
});
