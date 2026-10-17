// What the player and the pattern writer say to each other. Plain values
// only: this file has no framework imports, so it builds anywhere Swift does.
// A port of src/shared/types.ts in the Electron app.

import Foundation

/// The grid is sixteenth notes: sixteen steps to a bar of 4/4.
public let stepsPerBar = 16

/// Loop lengths the app offers, in bars.
public enum LoopBars: Int, Codable, CaseIterable, Sendable {
    case one = 1
    case two = 2
    case four = 4

    /// Steps in a loop this long.
    public var steps: Int { rawValue * stepsPerBar }
}

/// The OP-1 plays incoming notes on whichever instrument is selected, one at
/// a time, so Claude writes one part per pattern and the person says which.
public enum Part: String, Codable, CaseIterable, Sendable {
    case bass, chords, lead, arpeggio, drums
}

/// The OP-1 has four tape tracks, so at most four parts can be on tape.
public let maxTape = 4

/// One note in a loop: where it starts, which key, how long it holds.
public struct PatternNote: Codable, Equatable, Hashable, Sendable {
    /// Sixteenth-note step from the top of the loop, 0-based.
    public var step: Int
    /// MIDI note number; 60 is middle C.
    public var note: Int
    /// How many steps it holds, at least 1.
    public var length: Int

    public init(step: Int, note: Int, length: Int) {
        self.step = step
        self.note = note
        self.length = length
    }
}

public struct Pattern: Codable, Equatable, Sendable {
    public var bars: LoopBars
    public var notes: [PatternNote]

    public init(bars: LoopBars, notes: [PatternNote]) {
        self.bars = bars
        self.notes = notes
    }
}

/// A note the person played on the OP-1 while the loop ran. `step` and
/// `loopsAgo` are nil when it was played with the loop stopped: the pitch is
/// still worth knowing (it says what key they are in), the timing isn't.
public struct HeardNote: Codable, Equatable, Sendable {
    public var note: Int
    public var step: Int?
    public var loopsAgo: Int?
    public var length: Int?

    public init(note: Int, step: Int?, loopsAgo: Int?, length: Int?) {
        self.note = note
        self.step = step
        self.loopsAgo = loopsAgo
        self.length = length
    }
}

/// A part the person has recorded to the OP-1's tape and wants kept in mind.
public struct TapeLayer: Codable, Equatable, Sendable {
    public var part: Part
    public var pattern: Pattern

    public init(part: Part, pattern: Pattern) {
        self.part = part
        self.pattern = pattern
    }
}

public struct PatternRequest: Codable, Equatable, Sendable {
    public var part: Part
    public var tempo: Double
    public var bars: LoopBars
    public var direction: String
    /// Whether the direction changed since the pattern that's playing was written.
    public var newDirection: Bool
    public var current: Pattern?
    public var heard: [HeardNote]
    /// Note numbers the drum kit's keys send, learned from what was played.
    public var drumKeys: [Int]
    public var tape: [TapeLayer]

    public init(
        part: Part, tempo: Double, bars: LoopBars, direction: String, newDirection: Bool,
        current: Pattern?, heard: [HeardNote], drumKeys: [Int], tape: [TapeLayer]
    ) {
        self.part = part
        self.tempo = tempo
        self.bars = bars
        self.direction = direction
        self.newDirection = newDirection
        self.current = current
        self.heard = heard
        self.drumKeys = drumKeys
        self.tape = tape
    }
}

public struct PatternResponse: Codable, Equatable, Sendable {
    public var pattern: Pattern
    /// One line from Claude about what it wrote or changed.
    public var note: String
    /// How long the model took, in milliseconds, for the status line.
    public var ms: Int

    public init(pattern: Pattern, note: String, ms: Int) {
        self.pattern = pattern
        self.note = note
        self.ms = ms
    }
}

private let noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

/// MIDI note number to a name with octave: 60 → C4.
public func noteName(_ note: Int) -> String {
    let index = ((note % 12) + 12) % 12
    let octave = Int((Double(note) / 12).rounded(.down)) - 1
    return "\(noteNames[index])\(octave)"
}
