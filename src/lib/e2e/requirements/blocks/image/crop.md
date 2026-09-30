# Feature: Image crop

limestone's cover crop on an inline image. The toolbar's crop button turns the selected image
into an area the user can pan; the tick writes the result into the `|WxH` hint as `@X,Y[,Z]`,
this editor's own addition to the Obsidian-style size hint (`image-dimensions.ts`,
`image-source-bytes.ts`).

## Model

- `x`, `y` are whole percents: the image point held against the same point of the frame
- `z` is the zoom over the smallest scale that fills the frame, 1–4, at most two decimals, and
  is written only when it is not 1
- a crop needs a frame: the tail exists only on the `WxH` form; an unframed image gains its
  rendered box as `WxH` on its first crop
- a malformed tail leaves the whole hint as alt text (unit-covered in `image-dimensions.test.ts`)

## Session

- the crop button puts a pannable area over the image with corner brackets; the resize handle
  steps aside meanwhile
- a double click on the picture starts the crop too (a single click only selects it), and
  leaves no text range behind
- the brackets are the frame's handles: dragging one resizes the frame (and so its aspect),
  held where the image sits in the flow, between 32px and the column width
- drag pans against the pointer by the share of the overflow it covered; an axis with no
  overflow ignores its component; the wheel zooms (down zooms out); both clamp
  (unit-covered in `image-crop.test.ts`)
- the tick or Enter writes the crop; Escape, the cross, or a click away abandons it and
  restores the image untouched, with no source change and no undo entry
- a committed crop renders as a fixed frame (`md-image-cropped`, `object-fit: cover`) the image
  pans inside; resizing it keeps the frame's shape
- a crop loaded from bytes survives its own commit byte for byte (the tick over an untouched
  session writes nothing new), and a pan that does write is one undo away from the loaded bytes
- the resize handle on a cropped image resizes the frame, previewed on the frame rather than on
  the picture panned inside it: the picture keeps covering the frame at every point of the drag,
  and the frame keeps its shape (Shift unlocks nothing here, since the brackets are what change
  a frame's aspect)

## Miss-analysis

Two checks after a handle drag expected the loaded fixture's own bytes (`300x150@30,60,2`,
`200x100@30,60`), so a drag that wrote nothing would have passed them; G4.22 caught that they
proved nothing once the tree was merged, and the checks now exclude the size the fixture loaded
with.
