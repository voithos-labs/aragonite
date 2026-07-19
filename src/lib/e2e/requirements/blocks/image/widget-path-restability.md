# Feature: Image widget stays selectable after blocks shift around it

Inserting a block above an image moves the image to a new position without
changing its content, so the image is not re-rendered — it must still know
where it now lives. If it kept its original position, clicking it would target
the wrong block and the click would silently select nothing.

## User interactions

- Press Enter at the end of the block above an image (pushing the image down
  one position), then click the image: it still enters the selected state and
  shows its overlay.
