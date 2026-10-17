// Turning a hummed tune into a loop. Pure on purpose, like the prompt: no
// audio, no window, so it builds and tests on Linux. The microphone side
// lives in the Mac app. A port of src/shared/hum.ts in the Electron app, with
// one change: times are seconds on the JamClock, not milliseconds.
//
// Three steps:
// 1. `detectPitch` finds the pitch of a few dozen milliseconds of sound (YIN,
//    de Cheveigné & Kawahara 2002 — the usual method for a single voice).
// 2. `segment` strings those readings into notes: a note starts where the
//    voice starts or jumps to a new pitch, and ends where it stops.
// 3. `fitHum` puts the notes on the loop's grid, in one key, in the part's
//    octave.

import Foundation

// MARK: - 1. Pitch

/// Lowest and highest pitch a hum is looked for at: a low C to a high B.
public let minHz = 65.0
public let maxHz = 1000.0
/// YIN's threshold: lower is stricter about what counts as a pitch.
private let threshold = 0.15

public struct PitchReading: Equatable, Sendable {
    public var hz: Double
    /// 0–1: how cleanly periodic the sound is. A sung note is ~0.9.
    public var clarity: Double

    public init(hz: Double, clarity: Double) {
        self.hz = hz
        self.clarity = clarity
    }
}

/// JavaScript's Math.round: halves go up, not away from zero, so the two
/// codebases put the same note on the same step.
private func jsRound(_ x: Double) -> Double {
    (x + 0.5).rounded(.down)
}

/// The pitch of `buf`, or nil if it has none (breath, a consonant, silence).
/// `buf` should hold at least two periods of the lowest pitch plus a window.
public func detectPitch(_ buf: [Float], sampleRate: Double) -> PitchReading? {
    let tauMax = min(Int(sampleRate / minHz), buf.count / 2)
    let tauMin = max(2, Int(sampleRate / maxHz))
    let w = buf.count - tauMax
    if w < tauMax { return nil }

    // The difference function: how unlike the sound is to itself `tau` later.
    var d = [Double](repeating: 0, count: tauMax + 1)
    for tau in 1...tauMax {
        var sum = 0.0
        for j in 0..<w {
            let x = Double(buf[j] - buf[j + tau])
            sum += x * x
        }
        d[tau] = sum
    }
    // Normalised by its running mean, so the first dip under the threshold is
    // the period and not one of its multiples.
    var running = 0.0
    var cmnd = [Double](repeating: 0, count: tauMax + 1)
    cmnd[0] = 1
    for tau in 1...tauMax {
        running += d[tau]
        cmnd[tau] = running == 0 ? 1 : (d[tau] * Double(tau)) / running
    }

    var tau = tauMin
    while tau < tauMax {
        if cmnd[tau] < threshold {
            while tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau] { tau += 1 }
            break
        }
        tau += 1
    }
    if tau >= tauMax { return nil }

    // Between samples: fit a parabola through the dip and its neighbours.
    let a = cmnd[tau - 1]
    let b = cmnd[tau]
    let c = cmnd[tau + 1]
    let bend = a + c - 2 * b
    let exact = bend > 0 ? Double(tau) + (a - c) / (2 * bend) : Double(tau)
    return PitchReading(hz: sampleRate / exact, clarity: max(0, min(1, 1 - b)))
}

/// Frequency to a MIDI note number with a fraction: 440 → 69.
public func hzToMidi(_ hz: Double) -> Double {
    69 + 12 * log2(hz / 440)
}

/// Root-mean-square level of `buf`, 0–1. An empty buffer is silent.
public func level(_ buf: [Float]) -> Double {
    if buf.isEmpty { return 0 }
    var sum = 0.0
    for x in buf { sum += Double(x) * Double(x) }
    return (sum / Double(buf.count)).squareRoot()
}

// MARK: - 2. Notes

// HumFrame and RawNote are in Contracts.swift: the mic produces them too.

/// A note shorter than this is a scoop, a click or a cough.
private let minNote: TimeInterval = 0.070
/// How far the voice has to move, in semitones, to count as a new note.
private let jump = 0.75
/// …and for how many readings in a row, so a wobble doesn't split a note.
private let jumpFrames = 3
/// Missing readings bridged inside a note, so one bad reading doesn't split it.
private let gapFrames = 1

private func median(_ xs: [Double]) -> Double {
    let s = xs.sorted()
    let m = s.count >> 1
    return s.count % 2 == 1 ? s[m] : (s[m - 1] + s[m]) / 2
}

/// The quietest a frame can be and still count as voice: a few times the room's
/// own noise, from frames recorded before the person started.
public func noiseGate(_ quiet: [HumFrame]) -> Double {
    if quiet.isEmpty { return 0.01 }
    return min(0.05, max(0.004, median(quiet.map { $0.level }) * 3))
}

/// String readings, in time order, into notes.
public func segment(_ frames: [HumFrame], gate: Double) -> [RawNote] {
    var notes: [RawNote] = []
    var cur: [HumFrame] = []
    var jumped: [HumFrame] = []
    var missed = 0
    let hop: TimeInterval =
        frames.count > 1 ? (frames[frames.count - 1].time - frames[0].time) / Double(frames.count - 1) : 0.010

    func close(_ end: TimeInterval) {
        if !cur.isEmpty {
            let start = cur[0].time
            // The first fifth of a note is often a scoop up to the pitch; skip it.
            let settled = cur[(cur.count / 5)...].compactMap { $0.midi }
            if end - start >= minNote { notes.append(RawNote(start: start, end: end, pitch: median(settled))) }
        }
        cur = []
        jumped = []
    }

    for f in frames {
        guard let midi = f.midi, f.level >= gate else {
            missed += 1
            if missed > gapFrames && !cur.isEmpty { close(cur[cur.count - 1].time + hop) }
            continue
        }
        missed = 0
        if cur.isEmpty {
            cur.append(f)
            continue
        }
        let here = median(cur.suffix(8).compactMap { $0.midi })
        if abs(midi - here) > jump {
            // Off the note; a new note only if it stays off, and stays together.
            if let last = jumped.last?.midi, abs(midi - last) > jump { jumped = [] }
            jumped.append(f)
            if jumped.count >= jumpFrames {
                let next = jumped
                close(next[0].time)
                cur = next
            }
        } else {
            cur.append(contentsOf: jumped)
            cur.append(f)
            jumped = []
        }
    }
    if !cur.isEmpty { close(cur[cur.count - 1].time + hop) }
    return notes
}

// MARK: - 3. The loop

/// Where each part sits on the keyboard, as the prompt tells Claude. Drums
/// have no range: their keys are whatever the kit says.
public let partRange: [Part: ClosedRange<Int>] = [
    .bass: 28...55,
    .chords: 45...79,
    .lead: 57...88,
    .arpeggio: 45...84,
]

private let major = [0, 2, 4, 5, 7, 9, 11]
private let minor = [0, 2, 3, 5, 7, 8, 10]
private let keyNames = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

public struct Key: Equatable, Sendable {
    /// Pitch class, 0 = C.
    public var root: Int
    public var minor: Bool

    public init(root: Int, minor: Bool) {
        self.root = root
        self.minor = minor
    }
}

public func keyName(_ key: Key) -> String {
    "\(keyNames[key.root]) \(key.minor ? "minor" : "major")"
}

/// Pitch class of `note` above `root`, 0–11.
private func degree(_ note: Int, above root: Int) -> Int {
    (((note - root) % 12) + 12) % 12
}

private func inKey(_ note: Int, _ key: Key) -> Bool {
    (key.minor ? minor : major).contains(degree(note, above: key.root))
}

/// A note with how much it should count when choosing the key.
public struct WeightedNote: Equatable, Sendable {
    public var note: Int
    public var weight: Double

    public init(note: Int, weight: Double) {
        self.note = note
        self.weight = weight
    }
}

/// The key that fits the most of the tune, longer notes counting more. Notes
/// already in the loop or on tape count too, so the hum lands in their key.
/// Between a major key and its relative minor, the one whose root (and fifth)
/// the tune leans on wins.
public func guessKey(_ notes: [WeightedNote]) -> Key {
    var best = Key(root: 0, minor: false)
    var bestScore = -Double.infinity
    for root in 0..<12 {
        for isMinor in [false, true] {
            let key = Key(root: root, minor: isMinor)
            var score = 0.0
            for n in notes {
                if inKey(n.note, key) { score += n.weight }
                if degree(n.note, above: root) == 0 { score += n.weight * 0.5 }
                if degree(n.note, above: root + 7) == 0 { score += n.weight * 0.2 }
            }
            if score > bestScore + 1e-9 {
                bestScore = score
                best = key
            }
        }
    }
    return best
}

/// The nearest note in the key, deciding by the pitch as hummed.
private func snap(_ pitch: Double, _ key: Key) -> Int {
    let near = Int(jsRound(pitch))
    if inKey(near, key) { return near }
    // A note outside a major or minor key always has both neighbours inside it.
    return pitch >= Double(near) ? near + 1 : near - 1
}

/// The octave shift that puts the most notes in the part's range, moving as
/// little as it can: a tune already in range stays where it was hummed.
private func octaveShift(_ notes: [Int], _ range: ClosedRange<Int>) -> Int {
    var best = 0
    var bestCost = Int.max
    for k in -4...4 {
        let shift = k * 12
        let outside = notes.filter { !range.contains($0 + shift) }.count
        let cost = outside * 100 + abs(k)
        if cost < bestCost {
            bestCost = cost
            best = shift
        }
    }
    return best
}

public struct FitOptions: Equatable, Sendable {
    /// When step 0 of the hum sounded, in seconds on the JamClock.
    public var start: TimeInterval
    /// How long one step lasts, in seconds.
    public var step: TimeInterval
    public var bars: LoopBars
    /// Which part's octave to land in. Drums have no octave, so a hum fitted
    /// for drums stays where it was hummed.
    public var part: Part
    /// Notes already in play (the loop, tape), to choose the key with.
    public var context: [Int]

    public init(start: TimeInterval, step: TimeInterval, bars: LoopBars, part: Part, context: [Int] = []) {
        self.start = start
        self.step = step
        self.bars = bars
        self.part = part
        self.context = context
    }
}

/// A same-note restart this soon after a note stopped may be a dropout…
private let dropout: TimeInterval = 0.060
/// …if it starts this far off the grid, in steps, where nobody meant a new note.
private let offGrid = 0.25

/// Join a note to the one before when the sound only dropped out: the same
/// note, back within `dropout`, starting well between steps. A repeated note
/// the person sang ("da da") starts near a step and stays separate.
private func bridgeDropouts(_ raw: [RawNote], start: TimeInterval, step: TimeInterval) -> [RawNote] {
    var out: [RawNote] = []
    for r in raw.sorted(by: { $0.start < $1.start }) {
        let at = (r.start - start) / step
        if let prev = out.last,
            jsRound(prev.pitch) == jsRound(r.pitch),
            r.start - prev.end < dropout,
            abs(at - jsRound(at)) > offGrid
        {
            out[out.count - 1].end = max(prev.end, r.end)
            continue
        }
        out.append(r)
    }
    return out
}

public struct HumTake: Equatable, Sendable {
    public var pattern: Pattern
    public var key: Key

    public init(pattern: Pattern, key: Key) {
        self.pattern = pattern
        self.key = key
    }
}

/// A note on the grid before it is snapped to the key.
private struct Placed {
    var step: Int
    var length: Int
    var pitch: Double
}

/// The hummed notes as a loop: on the nearest step, in one key, one note at a
/// time, moved by whole octaves into the part's range.
public func fitHum(_ raw: [RawNote], options opts: FitOptions) -> HumTake {
    let total = opts.bars.steps
    var placed: [Placed] = []
    for r in bridgeDropouts(raw, start: opts.start, step: opts.step) {
        var step = Int(jsRound((r.start - opts.start) / opts.step))
        let end = Int(jsRound((r.end - opts.start) / opts.step))
        if step < 0 { step = 0 }
        if step >= total || end <= step { continue }
        placed.append(Placed(step: step, length: min(end, total) - step, pitch: r.pitch))
    }

    let key = guessKey(
        placed.map { WeightedNote(note: Int(jsRound($0.pitch)), weight: Double($0.length)) }
            + opts.context.map { WeightedNote(note: $0, weight: 1) })

    // One note at a time: two on one step keep the longer; each note ends
    // where the next begins. Ties keep the order they were hummed in.
    let ordered = placed.enumerated().sorted { a, b in
        if a.element.step != b.element.step { return a.element.step < b.element.step }
        if a.element.length != b.element.length { return a.element.length > b.element.length }
        return a.offset < b.offset
    }.map { $0.element }
    var mono: [Placed] = []
    for p in ordered where mono.last?.step != p.step { mono.append(p) }
    var notes: [PatternNote] = []
    for (i, p) in mono.enumerated() {
        let nextStep = i + 1 < mono.count ? mono[i + 1].step : total
        notes.append(PatternNote(step: p.step, note: snap(p.pitch, key), length: max(1, min(p.length, nextStep - p.step))))
    }

    var shift = 0
    if let range = partRange[opts.part], !notes.isEmpty {
        shift = octaveShift(notes.map { $0.note }, range)
    }
    return HumTake(
        pattern: Pattern(
            bars: opts.bars,
            notes: notes.map { PatternNote(step: $0.step, note: min(127, max(0, $0.note + shift)), length: $0.length) }),
        key: key)
}

/// "D4 F4 A4": the notes of a take, for the status line.
public func describeTake(_ take: HumTake) -> String {
    take.pattern.notes.map { noteName($0.note) }.joined(separator: " ")
}
