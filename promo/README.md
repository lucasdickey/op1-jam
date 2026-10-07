# The teaser

A 30-second teaser for OP-1 Jam, rendered from the app itself. Watch it at
[one-off.dev/op1-jam](https://one-off.dev/op1-jam).

```bash
npm run teaser    # → promo/out/op1-jam-teaser.mp4, about ten minutes
```

Needs a Mac with Google Chrome and ffmpeg (`brew install ffmpeg`).

It's made in three passes:

1. **`record.mjs`** runs the app's built page (`out/renderer`) in headless
   Chrome with a stand-in OP-1 and a stand-in Claude, on a fake clock, and
   saves a screenshot per frame plus every MIDI note the app sends.
2. **`audio.mjs`** is the soundtrack: it plays those notes on small synths
   (bass, chords, your lead, an 808-style kit) at the moments they were sent,
   keeps whatever is on tape looping, and adds the riser, impact and final hit.
3. **`compose.mjs`** renders **`director.html`** frame by frame at 60 fps (the
   camera, captions, cursor, key pop-ups and end card) and streams it into
   ffmpeg with the soundtrack.

**`session.mjs`** is the script: the loops (stand-ins written for the video),
the button presses, the keys played, and when Claude answers. Edit it and
render again.
