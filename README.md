# OP-1 Jam

Claude writes the notes. Your OP-1 plays them on whatever sound you pick.

**[Watch the 30-second teaser →](https://one-off.dev/op1-jam)**

OP-1 Jam is a Mac app for the original [teenage engineering OP-1](https://teenage.engineering/products/op-1).
Plug the OP-1 in over USB and Claude writes a short looping part — bass,
chords, lead, arpeggio or drums. The app plays it into the OP-1, and whatever
instrument you have selected on the device plays it. Play along on the OP-1's
keys and Claude answers you in the next loop. Record a part to the OP-1's
tape, switch to the next one, and Claude writes around what's on tape.

## What you need

- A Mac (Apple silicon or Intel).
- An original OP-1 and a USB to mini-USB cable that carries data.
- An [AI Gateway key](https://vercel.com/docs/ai-gateway) from Vercel. The app
  asks Claude for each loop through it.

## Install

1. Download the `.dmg` for your Mac from the latest run of the **Build**
   workflow (Actions → Build → newest run → Artifacts). The file ending in
   `arm64` is for Apple silicon; the other is for Intel.
2. Open it and drag **OP-1 Jam** into Applications.
3. The first time, right-click the app and choose **Open**, then **Open**
   again. The app isn't signed with an Apple developer account, so macOS asks
   once.
4. Paste your AI Gateway key when the app asks. It's stored encrypted with your
   Mac's Keychain. **Claude Key…** in the app menu (⌘,) changes or removes it.

Then follow the Getting started cards in the window. In short: put the OP-1 in
OP-1 mode (shift + COM, then T1), pick a sound, press Play.

## Hum a tune

Press **Hum** and the OP-1 counts you in with a bar of clicks. Hum a loop's
length (1, 2 or 4 bars, from **Loop**) while it keeps clicking, and the notes
appear as you go. The app puts the tune on the beat, in one key and in the
selected part's octave, then the OP-1 plays it back on loop on whatever sound
is selected. Hum again to redo it. To build on it, record it to the OP-1's
tape, press **I recorded this to tape**, pick another part and have Claude
write under it. **Write the next loop** with the same part selected gives a
variation on your tune.

- Wear headphones plugged into the OP-1, so the Mac's mic hears only you.
- Sing "da da da" rather than a steady "mmm": each "d" marks where a note
  starts. Simple tunes come out best; fast runs and slides get simplified.
- The sound never leaves the Mac. It is turned into notes as it arrives, and
  only the notes go to Claude. macOS asks for the mic the first time.

## How it works

- **The app keeps time, not Claude.** Claude takes seconds to answer, so the
  app loops the current pattern itself, stamping each MIDI note with the
  exact moment it should sound, and swaps in Claude's next pattern at the top
  of the loop.
- **One part at a time.** The OP-1 plays incoming MIDI on its selected
  instrument, so Claude writes one part per loop and you choose the sound.
- **Electron**, because it's Chrome inside: the app reaches the OP-1 through
  Chrome's MIDI support, which Safari's engine (what Tauri and similar
  wrappers use on a Mac) doesn't have.

| Part | Where | Does |
| --- | --- | --- |
| The page | `src/renderer/` | The jam: controls, the note screen, the timing (`jam/player.ts`), the mic (`jam/mic.ts`) |
| The bridge | `src/preload/` | The only functions the page can call, listed in `src/shared/native.ts` |
| The app | `src/main/` | Talks to macOS and to Claude (`claude.ts`); keeps the key |
| Shared | `src/shared/` | The loop's types, the prompt Claude gets (`prompt.ts`), hum to notes (`hum.ts`) |

The window is sandboxed, has Node switched off, and is blocked from the
network; only the app's main process talks to Claude.

## Develop

```bash
npm install
npm run dev          # opens the app; edits to the page reload it live
npm test             # the prompt, hum to notes, then the real app with a stand-in OP-1, Claude and voice
npm run typecheck
npm run dist         # builds the .dmg files into dist/
```

`OP1_MODEL` picks the model (an AI Gateway id; default
`anthropic/claude-opus-5.5`).

### Adding a Mac feature

Anything macOS offers through Electron or Node goes through the bridge, one
function at a time:

1. Name it in `src/shared/native.ts`.
2. Pass it along in `src/preload/index.ts`.
3. Do the work in `src/main/index.ts`, in a handler that checks the message
   came from the app's own page (`fromApp`).
4. Call it from the page as `native()?.yourFunction()`.

## License

[MIT](LICENSE) © 2026 Lucas Dickey, One-Off Dev Inc.

OP-1 is a trademark of teenage engineering. This project isn't affiliated with
or endorsed by teenage engineering or Anthropic.
