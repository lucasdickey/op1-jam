// Where everything is on an original OP-1, measured from photos of a real
// one. The top is a grid of 17 columns by 6 rows of 16 mm squares (the body
// is about 282 × 102 × 13 mm). The flat drawing (Op1Drawing.swift) is built
// from this. A port of src/renderer/jam/op1-layout.ts in the Electron app.
//
//   col: 0      2      4         8      10     12     14     16
//   r0  [speaker][volume][ screen  ][blue  ][green ][white ][orange][mic]
//   r1  [   ..   ][?][♩] [   ..    ][  ..  ][  ..  ][  ..  ][  ..  ][COM]
//   r2  [∿][◎][oo][ılı][T1][T2][T3][T4][1][2][3][4][5][6][7][8][seq]
//   r3  [lift][drop][split][ black keys ..............................]
//   r4  [rec][play][stop]  [ white keys, two rows tall, F to E .........]
//   r5  [ ‹ ][ › ][shift]  [ ...........................................]
//
// The right-hand edge (the short end by the keys) has, front to back: a
// strap slot, the power switch, mini USB, line in (ringed red), audio out
// for headphones (grey), another strap slot.

import Foundation

enum KeyId: String, Hashable {
    case help, tempo, synth, drum, tape, mixer
    case t1, t2, t3, t4
    case s1, s2, s3, s4, s5, s6, s7, s8, seq
    case mic, com
    case lift, drop, split, rec, play, stop, back, fwd, shift
    case piano, volume, blue, green, white, orange
    case power, usb, linein, phones
}

/// Ink colour of a glyph, as printed on the device.
enum Ink {
    case dark, blue, green, orange
}

/// One square key: grid position, and what's printed on it.
struct KeySpec {
    var id: KeyId
    var col: Int
    var row: Int
    var glyph: String
    /// Small second line, as on 1 IN, 7 M1, COM.
    var sub: String? = nil
    var ink: Ink = .dark
    /// Ink of the second line, when it differs.
    var subInk: Ink? = nil
    /// The record key's cap is solid orange.
    var solid = false
    var name: String
}

enum Op1Layout {
    static let cols = 17
    static let rows = 6

    static let keys: [KeySpec] = [
        KeySpec(id: .help, col: 2, row: 1, glyph: "?", name: "help"),
        KeySpec(id: .tempo, col: 3, row: 1, glyph: "♩", name: "tempo (metronome)"),
        KeySpec(id: .mic, col: 16, row: 0, glyph: "mic", ink: .orange, name: "mic / input"),
        KeySpec(id: .com, col: 16, row: 1, glyph: "◉", sub: "COM", name: "COM"),

        KeySpec(id: .synth, col: 0, row: 2, glyph: "∿", ink: .blue, name: "synth"),
        KeySpec(id: .drum, col: 1, row: 2, glyph: "◎", ink: .green, name: "drum"),
        KeySpec(id: .tape, col: 2, row: 2, glyph: "oo", ink: .orange, name: "tape"),
        KeySpec(id: .mixer, col: 3, row: 2, glyph: "ılı", name: "mixer"),
        KeySpec(id: .t1, col: 4, row: 2, glyph: "1", name: "T1"),
        KeySpec(id: .t2, col: 5, row: 2, glyph: "2", name: "T2"),
        KeySpec(id: .t3, col: 6, row: 2, glyph: "3", name: "T3"),
        KeySpec(id: .t4, col: 7, row: 2, glyph: "4", name: "T4"),
        KeySpec(id: .s1, col: 8, row: 2, glyph: "1", sub: "IN", subInk: .green, name: "1 / in"),
        KeySpec(id: .s2, col: 9, row: 2, glyph: "2", sub: "OUT", subInk: .green, name: "2 / out"),
        KeySpec(id: .s3, col: 10, row: 2, glyph: "3", sub: "↻", subInk: .green, name: "3 / loop"),
        KeySpec(id: .s4, col: 11, row: 2, glyph: "4", sub: "oo", subInk: .orange, name: "4 / tape"),
        KeySpec(id: .s5, col: 12, row: 2, glyph: "5", sub: "Я", subInk: .orange, name: "5 / reverse"),
        KeySpec(id: .s6, col: 13, row: 2, glyph: "6", sub: "•···", subInk: .orange, name: "6"),
        KeySpec(id: .s7, col: 14, row: 2, glyph: "7", sub: "M1", name: "7 / M1"),
        KeySpec(id: .s8, col: 15, row: 2, glyph: "8", sub: "M2", name: "8 / M2"),
        KeySpec(id: .seq, col: 16, row: 2, glyph: "⁘", ink: .blue, name: "sequencer"),

        KeySpec(id: .lift, col: 0, row: 3, glyph: "↑", sub: "1–4", ink: .orange, name: "lift"),
        KeySpec(id: .drop, col: 1, row: 3, glyph: "↓", ink: .orange, name: "drop"),
        KeySpec(id: .split, col: 2, row: 3, glyph: "✂", sub: "JOIN", ink: .orange, name: "split / join"),
        KeySpec(id: .rec, col: 0, row: 4, glyph: "●", ink: .orange, solid: true, name: "record"),
        KeySpec(id: .play, col: 1, row: 4, glyph: "▶", name: "play"),
        KeySpec(id: .stop, col: 2, row: 4, glyph: "■", name: "stop"),
        KeySpec(id: .back, col: 0, row: 5, glyph: "‹", name: "back"),
        KeySpec(id: .fwd, col: 1, row: 5, glyph: "›", name: "forward"),
        KeySpec(id: .shift, col: 2, row: 5, glyph: "Shift", name: "shift"),
    ]

    /// Two-by-two tiles with a knob in the middle.
    struct Encoder {
        var id: KeyId
        var col: Int
        var color: Int
        var name: String
    }

    static let encoders: [Encoder] = [
        Encoder(id: .blue, col: 8, color: 0x3a9be0, name: "blue encoder"),
        Encoder(id: .green, col: 10, color: 0x22a64b, name: "green encoder"),
        Encoder(id: .white, col: 12, color: 0xf2f2ef, name: "white encoder"),
        Encoder(id: .orange, col: 14, color: 0xf2622a, name: "orange encoder"),
    ]

    static let speaker = (col: 0, row: 0, w: 2, h: 2)
    /// The volume tile; its knob sits towards the left of it.
    static let volume = (col: 2, row: 0, w: 2, h: 1, knobCol: 2.5)
    static let screen = (col: 4, row: 0, w: 4, h: 2)

    /// Fourteen white keys, F to E, each one column wide and two rows tall.
    static let whiteKeys = 14
    static let keyboard = (col: 3, row: 4)
    /// Black keys sit on the line after these white keys (0 = the first F).
    static let blackAfter = [0, 1, 2, 4, 5, 7, 8, 9, 11, 12]
    /// The white key the drawing lights up for "play a key": the middle C.
    static let litKey = 4

    /// Along the right-hand edge, millimetres from the front (the keys' side).
    struct Jack {
        var id: KeyId
        var at: Double
        var ring: Int
        var name: String
    }

    enum Edge {
        static let depth = 102.0
        static let slots = [5.0, 97.0]
        static let power = (at: 21.0, travel: 5.0)
        static let usb = 42.0
        static let jacks: [Jack] = [
            Jack(id: .linein, at: 59, ring: 0xc8343a, name: "audio in"),
            Jack(id: .phones, at: 74, ring: 0xb5b9be, name: "audio out (headphones)"),
        ]
    }

    /// Printed-ink colours, from the photos.
    static func ink(_ ink: Ink) -> Int {
        switch ink {
        case .dark: return 0x3a3d42
        case .blue: return 0x3a8fd9
        case .green: return 0x1f9e4a
        case .orange: return 0xef6a2c
        }
    }
}
