// What the touch-selection probes share on both phones: page scripts that stage state and log what
// the page saw (expressions for CDP's evaluate and Appium's execute alike), and the readers that
// turn a log into a timeline. Every gesture stays a real touch on the device.
import { writeFileSync } from 'node:fs';
import path from 'node:path';

// Three short paragraphs whose middle words sit clear of both block edges.
export const PROBE_DOC = 'one two three four\n\nfive six seven eight\n\nnine ten eleven twelve\n';

export const blockOf = (index) => `[data-block-path="[${index}]"] [contenteditable="true"]`;

// Every event a touch selection raises, on the page's own clock, with its target and, at each
// selectionchange, the native selection; `window.__probe` holds the readers the scripts below use.
export const INSTALL_LOG = `(() => {
	const log = (window.__probeLog = []);
	const start = performance.now();
	const now = () => Math.round(performance.now() - start);
	const blockOf = (node) => {
		const el = node && (node.nodeType === 1 ? node : node.parentElement);
		const block = el && el.closest('[data-block-path], [data-b]');
		return block ? (block.dataset.blockPath ?? block.dataset.b) : null;
	};
	const sel = () => {
		const s = document.getSelection();
		if (!s || s.rangeCount === 0) return null;
		return {
			text: String(s).slice(0, 80),
			collapsed: s.isCollapsed,
			anchor: [blockOf(s.anchorNode), s.anchorOffset],
			focus: [blockOf(s.focusNode), s.focusOffset]
		};
	};
	const describe = (t) =>
		t === document ? 'document' : t === window ? 'window' : t && t.nodeType === 1
			? t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + (typeof t.className === 'string' && t.className ? '.' + t.className.split(' ')[0] : '')
			: '#text';
	window.__probe = { now, sel, mark: (what, extra) => log.push({ at: now(), what, ...extra }) };
	const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'click', 'contextmenu', 'selectstart', 'selectionchange', 'focusin', 'focusout', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'copy', 'cut', 'paste'];
	for (const type of types)
		document.addEventListener(type, (e) => {
			if (window.__probeLog !== log) return;
			const row = { at: now(), type, on: describe(e.target) };
			if (e.pointerType) row.pointer = e.pointerType;
			if (type === 'selectionchange') row.sel = sel();
			if (e.inputType) row.inputType = e.inputType;
			if (typeof e.data === 'string') row.data = e.data;
			if (e.clipboardData) row.clip = { types: [...e.clipboardData.types], text: e.clipboardData.getData('text/plain') };
			const point = e.touches ? e.touches[0] : e;
			if (type.endsWith('move') && point && 'clientX' in point) row.xy = [Math.round(point.clientX), Math.round(point.clientY)];
			log.push(row);
			setTimeout(() => (row.prevented = e.defaultPrevented));
		}, true);
	return true;
})()`;

export const READ_LOG = `(window.__probeLog ?? [])`;

// What the page holds now: the native range and its line boxes, the editor's selection, what the
// editor paints and which of its menus is open.
export const READ_STATE = `(() => {
	const p = window.__probe;
	const s = document.getSelection();
	const rects = s && s.rangeCount ? [...s.getRangeAt(0).getClientRects()].map((r) => [r.left, r.top, r.right, r.bottom].map(Math.round)) : [];
	let editor = null;
	try { editor = window.__test && document.querySelector('.editor') ? window.__test.getSelection() : null; } catch (e) { editor = 'unreadable: ' + e; }
	const active = document.activeElement;
	return {
		at: p ? p.now() : null,
		native: p ? p.sel() : null,
		rects,
		editor,
		painted: document.querySelectorAll('.selection-overlay').length,
		handles: [...document.querySelectorAll('.selection-handle')].map((h) => h.dataset.handle),
		menus: [...document.querySelectorAll('.md-menu')].map((m) => ({ toolbar: m.classList.contains('selection-toolbar'), items: [...m.querySelectorAll('.md-menu-item')].map((i) => i.textContent.trim()) })),
		active: active ? active.tagName.toLowerCase() + (typeof active.className === 'string' && active.className ? '.' + active.className.split(' ')[0] : '') : null,
		viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, top: visualViewport ? Math.round(visualViewport.offsetTop) : null }
	};
})()`;

// A word's box in viewport coordinates, the first time it appears under `selector`.
export function wordBox(selector, word) {
	return `(() => {
		const root = document.querySelector(${JSON.stringify(selector)});
		const walker = root && document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		for (let n = walker && walker.nextNode(); n; n = walker.nextNode()) {
			const at = n.data.indexOf(${JSON.stringify(word)});
			if (at < 0) continue;
			const range = document.createRange();
			range.setStart(n, at);
			range.setEnd(n, at + ${word.length});
			const b = range.getBoundingClientRect();
			return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2, left: b.left, right: b.right, top: b.top, bottom: b.bottom };
		}
		return null;
	})()`;
}

// The native range's last line box: where a browser draws the end handle.
export const RANGE_END = `(() => {
	const s = document.getSelection();
	if (!s || s.rangeCount === 0) return null;
	const rects = s.getRangeAt(0).getClientRects();
	const r = rects[rects.length - 1];
	return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, x: r.right, y: (r.top + r.bottom) / 2 } : null;
})()`;

// The collapsed native caret's box, or null when the browser gives it no height.
export const CARET_BOX = `(() => {
	const s = document.getSelection();
	if (!s || s.rangeCount === 0) return null;
	const range = s.getRangeAt(0);
	const b = range.getClientRects()[0] ?? range.getBoundingClientRect();
	return b.height > 0 ? { x: b.left, y: (b.top + b.bottom) / 2, top: b.top, bottom: b.bottom } : null;
})()`;

// Collapses the native range to a caret at its focus: at the first range under a held finger, or at
// the press's end (any event `end` names), a microtask, a task, the next range or `ms` after it.
export function collapseAt({ end, moment, ms = 0 }) {
	return `(() => {
		const p = window.__probe;
		const moment = ${JSON.stringify(moment)};
		const again = moment === 'sync, then the next range';
		let pressed = false;
		let ended = false;
		let left = again ? 2 : 1;
		const collapse = (why) => {
			const s = document.getSelection();
			if (left === 0 || !s || s.rangeCount === 0 || s.isCollapsed) return p.mark('nothing to collapse', { why });
			left--;
			const word = p.sel();
			s.collapse(s.focusNode, s.focusOffset);
			p.mark('collapsed', { why, word, after: p.sel() });
		};
		document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') pressed = true; }, true);
		document.addEventListener('selectionchange', () => {
			const s = document.getSelection();
			if (!s || s.rangeCount === 0 || s.isCollapsed || left === 0) return;
			if (moment === 'first range' && pressed) collapse('the first range');
			if ((moment === 'next range' || again) && ended) collapse('the next range');
		});
		for (const type of ${JSON.stringify(end.split(' '))})
			document.addEventListener(type, (e) => {
				if (e.pointerType !== 'touch' || ended) return;
				ended = true;
				p.mark(type + ' ended the press');
				if (moment === 'sync' || again) collapse(type);
				else if (moment === 'microtask') queueMicrotask(() => collapse('a microtask after'));
				else if (moment === 'task') setTimeout(() => collapse('a task after'));
				else if (moment === 'delay') setTimeout(() => collapse(${ms} + ' ms after'), ${ms});
			}, true);
		return true;
	})()`;
}

// The same collapse, run from outside once the gesture is over.
export const COLLAPSE_NOW = `(() => {
	const p = window.__probe;
	const s = document.getSelection();
	if (!s || s.rangeCount === 0 || s.isCollapsed) { p.mark('nothing to collapse', { why: 'after the lift' }); return false; }
	const word = p.sel();
	s.collapse(s.focusNode, s.focusOffset);
	p.mark('collapsed', { why: 'after the lift', word, after: p.sel() });
	return true;
})()`;

// Sets `caret-color` on the element `selector` names, now or at the next touch press.
export function caretColour(selector, value, { atPress = false } = {}) {
	return `(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		const set = () => { el.style.caretColor = ${JSON.stringify(value)}; window.__probe.mark('caret-color', { value: ${JSON.stringify(value)}, computed: getComputedStyle(el).caretColor }); };
		if (${atPress}) document.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && set(), { capture: true, once: true });
		else set();
		return getComputedStyle(el).caretColor;
	})()`;
}

// A stand-in editor handle at the native range's end: below it, on it, on Safari's knob or right of
// it. A move on it writes the block's first three characters, a range no browser handle leaves.
export function drawHandle(place, selector) {
	return `(() => {
		const p = window.__probe;
		const s = document.getSelection();
		if (!s || s.rangeCount === 0 || s.isCollapsed) return null;
		const rects = s.getRangeAt(0).getClientRects();
		const end = rects[rects.length - 1];
		const mid = (end.top + end.bottom) / 2;
		const place = ${JSON.stringify(place)};
		const box = {
			below: { left: end.right, top: end.bottom },
			on: { left: end.right - 22, top: mid - 22 },
			knob: { left: end.right - 22, top: end.bottom - 16 },
			right: { left: end.right + 18, top: mid - 22 }
		}[place];
		const h = document.createElement('div');
		h.id = 'probe-handle';
		h.style.cssText = 'position:fixed;width:44px;height:44px;z-index:2147483647;background:rgba(255,0,128,0.35);border-radius:50%;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;left:' + box.left + 'px;top:' + box.top + 'px';
		const first = document.createTreeWalker(document.querySelector(${JSON.stringify(selector)}), NodeFilter.SHOW_TEXT).nextNode();
		h.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			try { h.setPointerCapture(e.pointerId); } catch {}
			p.mark('handle pressed', { pointer: e.pointerType });
		});
		h.addEventListener('pointermove', () => {
			const r = document.createRange();
			r.setStart(first, 0);
			r.setEnd(first, Math.min(3, first.data.length));
			s.removeAllRanges();
			s.addRange(r);
		});
		document.body.appendChild(h);
		return { box: { ...box, width: 44, height: 44 }, end: [end.left, end.top, end.right, end.bottom].map(Math.round) };
	})()`;
}

// Keeps a tap's pointer, mouse and touch events from the editor, stopped at the window before any
// editor listener, so what the browser does on its own reads apart from the editor's tap rule.
export const HIDE_PRESSES = `(() => {
	for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend'])
		window.addEventListener(type, (e) => { e.stopPropagation(); window.__probe.mark('kept from the editor', { type }); }, true);
	return true;
})()`;

// Keeps contextmenu from the editor, whose root handler would cancel it and open its own menu.
export const KEEP_CONTEXTMENU_FROM_EDITOR = `(() => {
	window.addEventListener('contextmenu', (e) => { e.stopPropagation(); window.__probe.mark('contextmenu kept from the editor'); }, true);
	return true;
})()`;

// ── The bare page ──────────────────────────

const BARE_BLOCKS = [
	'first block alpha beta',
	'second block gamma delta',
	'third block epsilon zeta',
	'fourth kappa <span class="chip" contenteditable="false">chip</span> lambda',
	'fifth nu <span class="chip" contenteditable="false">image <span class="caption" contenteditable="true">caption</span></span> xi',
	...Array.from({ length: 24 }, (_, i) => `filler block ${i + 1}`)
];

// Replaces the page with one editing host over plain blocks that aren't editable themselves, the
// shape a shared host gives a block editor. `document.open` drops every listener the editor set.
export const BARE_HOST = `(() => {
	document.open();
	document.write(${JSON.stringify(
		'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
			'<style>body{margin:0;font:18px/1.7 sans-serif}#host{padding:12px 20px;outline:none}p{margin:0 0 12px}' +
			'.chip{display:inline-block;padding:0 8px;border-radius:9px;background:#dde3f0}</style></head>' +
			`<body><div id="host" contenteditable="true">${BARE_BLOCKS.map((b, i) => `<p data-b="${i}">${b}</p>`).join('')}</div></body></html>`
	)});
	document.close();
	return true;
})()`;

export const bareBlock = (index) => `#host > [data-b="${index}"]`;

export const BARE_TEXT = `[...document.querySelectorAll('#host > p')].slice(0, 5).map((p) => ({ b: p.dataset.b, text: p.textContent, html: p.innerHTML }))`;

// Removes the bare page's last block once the native focus leaves the first, as windowing unmounts
// a far block while a handle is still dragging.
export const REMOVE_FAR_BLOCK_MID_DRAG = `(() => {
	const p = window.__probe;
	let done = false;
	document.addEventListener('selectionchange', () => {
		const s = p.sel();
		if (done || !s || s.focus[0] === null || s.focus[0] === '0') return;
		done = true;
		const far = document.querySelector('#host > p:last-child');
		p.mark('removed a far block', { b: far.dataset.b, sel: s });
		far.remove();
	});
	return true;
})()`;

// Gutenberg's fence on another region for the length of a touch: not selectable, not editable.
export const FENCE_CHIP = `(() => {
	const chip = document.querySelector('.chip');
	const set = (on) => {
		chip.style.userSelect = on ? 'none' : '';
		chip.style.webkitUserSelect = on ? 'none' : '';
		chip.style.webkitUserModify = on ? 'read-only' : '';
		window.__probe.mark(on ? 'fence up' : 'fence down');
	};
	document.addEventListener('touchstart', () => set(true), true);
	for (const type of ['touchend', 'touchcancel']) document.addEventListener(type, () => set(false), true);
	return true;
})()`;

export function centreOf(selector) {
	return `(() => {
		const b = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
		return b ? { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 } : null;
	})()`;
}

// ── Reading the log ──────────────────────────

// A probe's whole record, beside the short outcome `result.json` keeps.
export function save(out, slug, record) {
	writeFileSync(path.join(out, `${slug}.json`), JSON.stringify(record, null, 2));
	return `${slug}.json`;
}

// The log as one line per event, moves left out: `at type@target`, a selection's text and ends.
export function timeline(log) {
	return log
		.filter((r) => r.type !== 'pointermove' && r.type !== 'touchmove')
		.map((r) => {
			const parts = [r.at, r.what ?? `${r.type}@${r.on}`];
			if (r.sel)
				parts.push(
					r.sel.collapsed ? 'caret' : JSON.stringify(r.sel.text),
					`${r.sel.anchor}..${r.sel.focus}`
				);
			if (r.inputType) parts.push(r.inputType);
			if (r.data !== undefined) parts.push(JSON.stringify(r.data));
			if (r.clip) parts.push(`clipboard ${r.clip.types.join(',')} ${JSON.stringify(r.clip.text)}`);
			if (r.why) parts.push(`(${r.why})`);
			if (r.error) parts.push(r.error);
			if (r.value !== undefined) parts.push(JSON.stringify(r.value));
			if (r.ms !== undefined) parts.push(`${r.ms} ms`);
			if (r.prevented) parts.push('prevented');
			return parts.join(' ');
		});
}

// When the browser wrote the selection, against the touch press's end (`pointerup` on iOS,
// `pointercancel` on Android): its first and last ranges and every selectionchange after the end.
export function writes(log, end) {
	const ended =
		log.find((r) => end.split(' ').includes(r.type) && r.pointer === 'touch')?.at ?? null;
	const changes = log.filter((r) => r.type === 'selectionchange');
	const ranged = changes.filter((r) => r.sel && !r.sel.collapsed);
	return {
		[end]: ended,
		firstRange: ranged[0]?.at ?? null,
		lastRange: ranged.at(-1)?.at ?? null,
		lastRangeAfterEnd: ended === null || !ranged.length ? null : ranged.at(-1).at - ended,
		collapsedAt: log.find((r) => r.what === 'collapsed')?.at ?? null,
		changesAfterEnd:
			ended === null
				? []
				: changes
						.filter((r) => r.at >= ended)
						.map(
							(r) => `+${r.at - ended} ${r.sel?.collapsed ? 'caret' : JSON.stringify(r.sel?.text)}`
						)
	};
}

// The parts of a look a reader scans first; the whole look is in the probe's file.
export function brief(look) {
	if (!look) return null;
	const { shot, native, editor, painted, handles, menus, keyboard } = look;
	const menu = (look.menu ?? look.menuNodes)?.map((i) =>
		i.inPage === undefined ? i.label : `${i.text || i.desc}${i.inPage ? ' (page)' : ' (chrome)'}`
	);
	return { shot, native, editor, painted, handles, menus, menu, keyboard };
}
