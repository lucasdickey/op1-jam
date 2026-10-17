# OP-1 Jam for Mac

The same jam as the Electron app, native: SwiftUI for the window, CoreMIDI
for the OP-1, AVAudioEngine for the mic, the Keychain for the key. No
Electron, no Chrome, no Node.

Claude writes a short looping part, the app plays it into the OP-1, and
whatever instrument you have selected on the device plays it. Play along and
Claude answers in the next loop; hum a tune and the app puts it on the beat.
The root [README](../README.md) explains the jam itself; this one is about
the native app.

## Why native

- **No MIDI permission prompt.** CoreMIDI just sees the OP-1. The Electron
  app has to go through Chrome's MIDI support, which asks first.
- **Small bundle.** A few megabytes instead of a copy of Chrome.
- **Instant launch.** No browser to start before the window appears.
- **Tighter timing.** Notes are stamped on the host clock and handed to
  CoreMIDI, which schedules them itself; nothing passes through a renderer
  process on the way to the cable.

## Run

```bash
cd mac
swift run Op1Jam        # development: builds and opens the app
scripts/bundle.sh       # builds dist/OP-1 Jam.app, ad-hoc signed
```

The bundle isn't signed with an Apple developer account, so the first time,
right-click the app and choose **Open**, then **Open** again.

Humming needs the bundle: a bare `swift run` binary has no `Info.plist`, and
macOS ends a process that asks for the mic without one. MIDI and Claude work
either way.

Prefer Xcode? `project.yml` describes the same targets for
[XcodeGen](https://github.com/yonaskolb/XcodeGen):

```bash
brew install xcodegen
cd mac && xcodegen generate && open Op1Jam.xcodeproj
```

The `.xcodeproj` is generated and ignored by git; `Package.swift` stays the
source of truth.

## Test

```bash
swift test
```

The core (`Op1Core`) is plain Swift with no Apple frameworks, so its tests
run on a Mac or on Linux: the prompt Claude gets, hum to notes, the loop's
types and the player's timing. The app target only builds on a Mac.

On a Mac the tests need a full Xcode, not just the Command Line Tools: the
tests use XCTest, which the Command Line Tools leave out. Building and
bundling the app work with either.

## Environment

| Variable | Does |
| --- | --- |
| `OP1_MODEL` | Picks the model, as an AI Gateway id. Default `anthropic/claude-opus-5.5`. |
| `OP1_GATEWAY_KEY` | Used instead of the Keychain when set: for tests, and for running from the terminal without touching the Keychain. |

Without `OP1_GATEWAY_KEY`, the app asks for your
[AI Gateway key](https://vercel.com/docs/ai-gateway) the first time and keeps
it in the Keychain under the service "OP-1 Jam". **Claude Key…** in the app
menu (⌘,) changes or removes it.

## How it works

- **The app keeps time, not Claude.** Claude takes seconds to answer, so the
  app loops the current pattern itself, stamping each MIDI note with the
  exact moment it should sound, and swaps in Claude's next pattern at the top
  of the loop. Times are seconds on one monotonic clock, shared by the
  player, the MIDI side and the mic.
- **One part at a time.** The OP-1 plays incoming MIDI on its selected
  instrument, so Claude writes one part per loop and you choose the sound.
- **The sound never leaves the Mac.** The mic is turned into notes as it
  arrives, and only the notes go to Claude. macOS asks for the mic the first
  time, with the wording in `Info.plist`.
- **Only the Claude call touches the network.** The app isn't sandboxed (so
  CoreMIDI can see the OP-1), but the only outbound request it makes is the
  one to the AI Gateway.

| Part | Where | Does |
| --- | --- | --- |
| The core | `Sources/Op1Core/` | The loop's types, the prompt Claude gets (`Prompt.swift`), hum to notes (`Hum.swift`), the player's timing (`Player.swift`). No Apple frameworks; builds on Linux |
| MIDI | `Sources/Op1Jam/MIDI/` | CoreMIDI: finds the OP-1, sends timestamped notes, reads what you play |
| Claude | `Sources/Op1Jam/Claude/` | The AI Gateway request and the Keychain key store |
| Audio | `Sources/Op1Jam/Audio/` | AVAudioEngine: the mic, stamped on the same clock, for Hum |
| UI | `Sources/Op1Jam/UI/` | SwiftUI: the controls, the note screen, the Getting started cards |
| Contracts | `Sources/Op1Jam/AppContracts.swift` | What those parts promise each other, so each can be built and tested alone |

## Packaging

`scripts/bundle.sh` runs `swift build -c release`, assembles
`dist/OP-1 Jam.app` around the binary with `Info.plist` and an icon converted
from the repo's `build/icon.png` (via `sips` and `iconutil`, skipped if
there is no icon), then signs it ad hoc with `Op1Jam.entitlements` and the
hardened runtime. To ship it, replace the `-` in the `codesign` line with a
Developer ID and notarize.

## License

[MIT](../LICENSE) © 2026 Lucas Dickey, One-Off Dev Inc.

OP-1 is a trademark of teenage engineering. This project isn't affiliated with
or endorsed by teenage engineering or Anthropic.
