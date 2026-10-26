// Which theme the demo site shows: the visitor's last choice, kept in the browser, else the
// showcase's default. Every page of the site reads and writes it here, so they agree.
import { INITIAL_STATE, type ShowcaseTheme } from './controls';

const STORAGE_KEY = 'aragonite-showcase-theme';

export function readTheme(): ShowcaseTheme {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === 'light' || stored === 'dark') return stored;
	} catch {
		// No storage (a prerender, a blocked store): the default stands.
	}
	return INITIAL_STATE.theme;
}

/** An inline script for the end of a prerendered page's themed wrapper: it sets the stored theme
 *  on the wrapper and everything in it before the page first paints, ahead of hydration. */
export const STORED_THEME_SCRIPT = `<script>try{const t=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(t==='light'||t==='dark'){const w=document.currentScript.parentElement;for(const e of [w,...w.querySelectorAll('[data-editor-theme]')])e.setAttribute('data-editor-theme',t)}}catch{}</script>`;

/** Flips `current`, remembers the result and returns it. */
export function toggleTheme(current: ShowcaseTheme): ShowcaseTheme {
	const next = current === 'dark' ? 'light' : 'dark';
	try {
		localStorage.setItem(STORAGE_KEY, next);
	} catch {
		// A blocked store keeps the choice for this page only.
	}
	return next;
}
