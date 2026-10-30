# Caret: the caret beside a picture shows where the next letter lands

A picture sits in its line, and beside it the browser paints its caret the line box tall (or not at all), so the drawn caret's bar shows the caret there, on any pointer. Whichever route put the caret beside a picture, the bar stands at the picture's edge where the next typed letter lands: its left and middle within 1px of that letter's box, and as tall as the bar the same engine draws for that line's text: at the text where the line holds some, else in an empty paragraph (Firefox draws an empty line's bar the line box tall, the others the text's height). Beside a widget that sits in its line at the text's height (a decoded entity, an emoji, a formula), the browser's own caret shows unless a click asked for the bar. Each row runs in live mode, and each measures that reference bar in the same document.

Miss-analysis: every bar row read the bar against the picture's own box, never against the letter typed next, so a bar standing 60px above the letter, or on another line, passed.

## Happy paths

- `![x](…)` alone, after it, by Backspace on the empty paragraph below, a click past it, a caret put at its end, an undo of a letter typed there, and Enter then Backspace: the bar stands where `Q` then lands, after the picture on its line
- `![x](…)` alone, before it, by a caret put at its start and by Home from its end: the bar stands where `Q` lands, before the picture on its line
- `[![alt](…)](https://x.y)` alone, after it (Backspace from below, a caret put at its end) and before it: the same, `Q` outside the link on that side
- a picture in a list item, after it (a click past) and before it: the same
- a picture in a quote, after it (a click past): the same
- `lead ![x](…)`, a caret put at its end: the bar stands after the picture, where `Q` lands
- two pictures side by side, the caret between them: the bar stands after the first, where `Q` lands
- `![x](…) trail`, a caret put at its start: the bar stands before the picture, at the height of the text beside it

## Edge cases

- `lead &copy;`, caret put at its end: the browser's own caret shows beside the ©, no bar, and `Q` lands at the end
- a click past a decoded entity, an emoji and a formula: the bar the click asks for stands where `Q` then lands
