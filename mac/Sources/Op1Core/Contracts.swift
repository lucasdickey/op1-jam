// The seams between the core and the Mac around it. The core never touches
// CoreMIDI or the microphone: it reads time from a JamClock and writes MIDI
// to a MIDISink, and the app supplies both. Tests supply fakes.

import Foundation

/// One clock for everything that has to line up: the player's note times,
/// the MIDI port's timestamps and the mic's readings. Seconds, monotonic,
/// starting anywhere. On the Mac it is mach host time in seconds.
public protocol JamClock: Sendable {
    func now() -> TimeInterval
}

/// Somewhere to send MIDI bytes, timed on the JamClock. A time of 0 or in the
/// past means "now". The Mac implements this over CoreMIDI, which honours
/// the timestamp itself, so a late caller only shrinks its own margin.
public protocol MIDISink: AnyObject {
    func send(_ bytes: [UInt8], at time: TimeInterval)
}

/// One reading of the mic: when, how loud, and the pitch if there is one.
public struct HumFrame: Equatable, Sendable {
    /// Seconds on the JamClock, the moment the sound reached the mic.
    public var time: TimeInterval
    /// 0–1 RMS level of the window the reading was taken on.
    public var level: Double
    /// MIDI note number with a fraction, or nil for no pitch.
    public var midi: Double?

    public init(time: TimeInterval, level: Double, midi: Double?) {
        self.time = time
        self.level = level
        self.midi = midi
    }
}

/// A hummed note before it is put on the grid. Times in seconds on the JamClock.
public struct RawNote: Equatable, Sendable {
    public var start: TimeInterval
    public var end: TimeInterval
    /// MIDI note number with a fraction.
    public var pitch: Double

    public init(start: TimeInterval, end: TimeInterval, pitch: Double) {
        self.start = start
        self.end = end
        self.pitch = pitch
    }
}
