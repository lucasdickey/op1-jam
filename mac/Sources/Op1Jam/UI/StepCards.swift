// Getting started, as a short deck of cards rather than a manual: one step
// per card, a few short lines each. The OP-1 steps follow teenage
// engineering's OP-1 guides: COM and OP-1 mode from "song rendering and
// connectivity", sync from "tempo", recording from "tape mode", sounds from
// "synthesizer mode" and "drum mode", the ports from "overview". Cards about
// the OP-1 itself show it (Op1Demo.swift), with the keys to press lit in
// order. The cards from steps.tsx, less the browser's MIDI permission, which
// a Mac app doesn't have.

import Foundation

/// One beat of a card's demo: what to do, and what the drawing shows.
struct Beat {
    /// What to do, shown under the drawing. Markdown; a key is in `code`.
    var say: String
    /// Keys held down through this beat.
    var hold: [KeyId] = []
    /// Keys pressed (or knobs turned, or the switch slid) on this beat.
    var press: [KeyId] = []
    var screen: ScreenState = .reels
    /// How long the beat lasts when stepping by itself.
    var seconds: Double = 2
}

struct Slide: Identifiable {
    var id: String
    var title: String
    var optional = false
    /// Markdown lines; a key is in `code`.
    var points: [String]
    /// Keys to press on the OP-1, played on a drawing of it.
    var demo: [Beat]? = nil
}

/// The connect card changes with the OP-1: it says so when it is in.
func stepSlides(connected: Bool, outputName: String?) -> [Slide] {
    let connectLine: String
    if connected {
        connectLine = "✓ Connected" + (outputName.map { " to \($0)" } ?? "")
    } else {
        connectLine = "The app connects by itself once the OP-1 is plugged in and in OP-1 mode."
    }
    return [
        Slide(
            id: "plug",
            title: "Plug in the OP-1",
            points: [
                "Use a USB to mini-USB cable that carries data, not just charge. Plug it into the OP-1 first, then the Mac.",
                "Plug headphones into the OP-1: the sound comes out of it, and with headphones the Mac’s mic hears only you when you hum.",
            ],
            demo: [
                Beat(say: "Plug the cable into the mini USB port on the right-hand end", press: [.usb], seconds: 2.4),
                Beat(say: "Headphones go in the grey jack at the back corner. The red one is line in.", press: [.phones], seconds: 2.6),
                Beat(say: "Slide the power switch toward you", press: [.power], seconds: 2.4),
                Beat(say: "Turn the volume up: the white knob left of the screen", press: [.volume]),
            ]),
        Slide(
            id: "mode",
            title: "Put it in OP-1 mode",
            points: [
                "OP-1 mode plays notes sent over USB and sends the keys you play back, on MIDI channel 1.",
                "Not `T3`: that’s disk mode, and the app can’t see it. `T2` is controller mode, which doesn’t play the notes it’s sent.",
            ],
            demo: [
                Beat(say: "Hold `shift`", hold: [.shift], seconds: 1.2),
                Beat(say: "…and press `COM`, under the mic key: COM opens", hold: [.shift], press: [.com], screen: .com),
                Beat(say: "Press `T1` for OP-1 mode", press: [.t1], screen: .op1, seconds: 2.2),
            ]),
        Slide(
            id: "connect",
            title: "Connect the app",
            points: [
                connectLine,
                "Not in the list? Check the OP-1 is in OP-1 mode and no other music app is using it, then unplug it and plug it in again.",
            ]),
        Slide(
            id: "hear",
            title: "Check you can hear it",
            points: [
                "Test sound plays three rising notes.",
                "Silent? Turn the OP-1’s volume up, and check Channel matches the OP-1’s (1 unless you changed it).",
            ],
            demo: [
                Beat(say: "Press the synth key", press: [.synth], screen: .synth),
                Beat(say: "Pick a sound with `1`–`8`", press: [.s1, .s2, .s3, .s4, .s5, .s6, .s7, .s8], screen: .synth),
                Beat(say: "Play a key to hear it", press: [.piano], screen: .synth),
                Beat(say: "`‹` and `›` shift the keyboard an octave", press: [.back, .fwd], screen: .synth),
            ]),
        Slide(
            id: "play",
            title: "Play with Claude",
            points: [
                "Pick a part to match the sound: bass, chords, lead or arpeggio.",
                "Press ▶ Play. Claude writes a loop in a few seconds.",
                "Play along on the OP-1. Claude answers in the next loop.",
            ]),
        Slide(
            id: "hum",
            title: "Hum a tune",
            optional: true,
            points: [
                "Wear headphones plugged into the OP-1, so the mic hears only you.",
                "Pick the part and loop length, then press Hum. The OP-1 clicks a bar to count you in.",
                "Hum while it keeps clicking. Sing “da da da” rather than “mmm” for clear notes.",
                "The OP-1 plays your tune back. Hum again to redo it.",
            ],
            demo: [
                Beat(say: "Headphones in the grey jack at the back corner", press: [.phones], seconds: 2.6),
                Beat(say: "Volume up enough to hear the clicks", press: [.volume]),
            ]),
        Slide(
            id: "drums",
            title: "Drums",
            optional: true,
            points: [
                "Choose Drums.",
                "Tap each drum key you want Claude to use. The app learns them.",
            ],
            demo: [
                Beat(say: "Press the drum key", press: [.drum], screen: .drum),
                Beat(say: "Pick a kit with `1`–`8`", press: [.s1, .s2, .s3, .s4, .s5, .s6, .s7, .s8], screen: .drum),
                Beat(say: "Tap the drum keys you want", press: [.piano], screen: .drum),
            ]),
        Slide(
            id: "tape",
            title: "Record to tape",
            optional: true,
            points: [
                "Record the loop that’s playing onto one of the OP-1’s four tape tracks.",
                "Then press “I recorded this to tape”, pick the next part and sound, and Claude writes around it.",
            ],
            demo: [
                Beat(say: "Press the tape key", press: [.tape], screen: .tape),
                Beat(say: "Pick a track with `T1`–`T4`", press: [.t1], screen: .tape),
                Beat(say: "Hold `rec` and press `play`", hold: [.rec], press: [.play], screen: .tape),
                Beat(say: "Press `stop` when done", press: [.stop], screen: .tape),
            ]),
        Slide(
            id: "sync",
            title: "Stay in time",
            optional: true,
            points: [
                "Only if you want the OP-1’s own tape or sequencers to follow the app.",
                "Tick Send clock.",
            ],
            demo: [
                Beat(say: "Press the tempo key", press: [.tempo], screen: .reels),
                Beat(say: "Turn the green encoder until EXT shows", press: [.green], screen: .ext, seconds: 2.2),
            ]),
    ]
}

/// The fixes under "Something not working?". Markdown.
let stepFixes: [String] = [
    "**OP-1 not in the list:** check it’s in OP-1 mode (`shift` + `COM`, `T1`), the cable carries data, and no other music app is using it. Unplug it and plug it in again.",
    "**No sound:** OP-1 volume up, and the OP-1 in OP-1 mode, not controller mode (`T2`). Channel must match the OP-1’s: 1 by default, and `shift` + the blue encoder shows or changes it on the OP-1.",
    "**A note keeps sounding:** press Stop.",
    "**Red message under the screen:** press Write the next loop to try again.",
]
