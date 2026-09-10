# Feature: Image crop

limestone's cover crop on an inline image. The toolbar's crop button turns the selected image
into a pan surface; the tick writes the result into the `|WxH` hint as `@X,Y[,Z]`, this editor's
own tail on the Obsidian-style size hint (`image-dimensions.ts`, `image-source-bytes.ts`).

## Model

- `x`, `y` are whole percents: the image point pinned to the same point of the frame
- `z` is the zoom over the smallest scale that fills the frame, 1–4, at most two decimals, and
  is written only when it is not 1
- a crop needs a frame: the tail exists only on the `WxH` form; an unframed image gains its
  rendered box as `WxH` on its first crop
- a malformed tail leaves the whole hint as alt text (unit-covered in `image-dimensions.test.ts`)

## Session

- the crop button mounts a pan surface over the image with corner brackets; the resize grip
  steps aside meanwhile
- the brackets are the frame's handles: dragging one resizes the frame (and so its aspect),
  anchored where the image sits in the flow, between 32px and the column width
- drag pans against the pointer by the share of the overflow it covered; an axis with no
  overflow ignores its component; the wheel zooms (down zooms out); both clamp
  (unit-covered in `image-crop.test.ts`)
- the tick or Enter writes the crop; Escape, the cross, or a click away abandons it and
  restores the image untouched, with no source change and no undo entry
- a committed crop renders as a fixed frame (`md-image-cropped`, `object-fit: cover`) the image
  pans inside; resizing it keeps the frame's shape
- the resize grip on a cropped image resizes the FRAME, previewed on the frame rather than on
  the picture panned inside it: the picture keeps covering the frame at every point of the drag,
  and the frame keeps its shape (Shift unlocks nothing here — the brackets change a frame's
  aspect)
