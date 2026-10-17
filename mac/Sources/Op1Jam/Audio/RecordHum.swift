// One hummed take: a bar of clicks on the OP-1 to count in, then the loop's
// length of humming over more clicks, then the tune on the loop's grid. A
// port of src/renderer/jam/hum.ts in the Electron app, with times in seconds
// on the JamClock and cancellation from the Task.
//
// The player keeps time throughout. Whatever it was playing is muted for the
// take (the clock to the OP-1 carries on, so its tape stays in step), and the
// take starts looping as soon as it's ready, in step with the bars it was
// hummed over.

import Foundation
import Op1Core

public struct HumProgress: Equatable, Sendable {
    public enum Phase: String, Sendable {
        case count, hum, done
    }

    public var phase: Phase
    /// Count-in beats left (4, 3, 2, 1), or the bar being hummed (1-based).
    public var beat: Int
    /// The tune so far, while humming.
    public var take: HumTake?
    /// When step 0 of the hum sounds, and a step's length, for the playhead.
    public var start: TimeInterval
    public var stepSeconds: TimeInterval

    public init(phase: Phase, beat: Int, take: HumTake?, start: TimeInterval, stepSeconds: TimeInterval) {
        self.phase = phase
        self.beat = beat
        self.take = take
        self.start = start
        self.stepSeconds = stepSeconds
    }
}

public struct HumOptions: Sendable {
    public var bars: LoopBars
    /// Any part but drums, which have no tune to hum.
    public var part: Part
    /// Notes already in play, to choose the key with.
    public var context: [Int]
    /// Told how the take is going, on the main actor, a few times a second.
    public var onProgress: @MainActor @Sendable (HumProgress) -> Void

    public init(bars: LoopBars, part: Part, context: [Int] = [], onProgress: @escaping @MainActor @Sendable (HumProgress) -> Void) {
        self.bars = bars
        self.part = part
        self.context = context
        self.onProgress = onProgress
    }
}

/// A take that didn't work out, worded for the person.
public struct HumError: LocalizedError, Equatable {
    public let line: String
    public init(_ line: String) { self.line = line }
    public var errorDescription: String? { line }
}

/// How often the tune on the screen catches up with the humming.
private let redraw: TimeInterval = 0.120
/// How long after the take's last beat to keep listening, for the mic's delay.
private let tail: TimeInterval = 0.250

/// The mic's readings, gathered on the engine's thread and read on another.
private final class FrameLog: @unchecked Sendable {
    private let lock = NSLock()
    private var frames: [HumFrame] = []

    func add(_ frame: HumFrame) {
        lock.lock()
        frames.append(frame)
        lock.unlock()
    }

    var all: [HumFrame] {
        lock.lock()
        defer { lock.unlock() }
        return frames
    }
}

/// Record a take and hand it to the player. Returns the take, or throws
/// HumError (no tune heard, no mic) or CancellationError. On any failure the
/// player is left as it was found.
public func recordHum(player: Player, mic: MicCapturing, clock: JamClock, options opts: HumOptions) async throws -> HumTake {
    let frames = FrameLog()
    do {
        try await mic.start { frames.add($0) }
    } catch let err as MicError {
        throw HumError(err.line)
    }
    let wasPlaying = player.playing
    var handed = false
    defer {
        mic.stop()
        if !handed {
            player.setClick(from: .infinity, until: -.infinity)
            player.setMuted(false)
            if !wasPlaying { player.stop() }
        }
    }

    try Task.checkCancellation()
    player.cancelPending()
    player.setMuted(true)
    // Stopped, the clicks start with the loop: that first bar is the count-in.
    if !wasPlaying {
        player.setClick(from: 0, until: .infinity)
        player.start()
        if !player.playing { throw HumError("Connect the OP-1 to hum to it.") }
    }
    let step = player.stepSeconds()
    let bar = step * Double(stepsPerBar)
    let beat = step * 4
    // Hum from the first bar line with a whole bar of count-in before it.
    // Stopped, that's the loop's second bar; playing, the count-in's first
    // click must still be ahead of what the player has already scheduled.
    let room: TimeInterval = wasPlaying ? 0.150 : -0.080
    guard let start = player.barAfter(clock.now() + bar + room) else {
        throw HumError("Connect the OP-1 to hum to it.")
    }
    let end = start + Double(opts.bars.rawValue) * bar
    player.setClick(from: start - bar, until: end)

    func fit(upTo: TimeInterval) -> HumTake {
        let all = frames.all
        let gate = noiseGate(all.filter { $0.time < start - step })
        let raw = segment(all.filter { $0.time >= start - step / 2 && $0.time < upTo }, gate: gate)
        return fitHum(raw, options: FitOptions(start: start, step: step, bars: opts.bars, part: opts.part, context: opts.context))
    }

    // Count in, then hum, redrawing as it goes.
    while clock.now() < end + tail {
        try await Task.sleep(nanoseconds: UInt64(redraw * 1_000_000_000))
        let now = clock.now()
        if now < start {
            let left = max(1, Int(((start - now) / beat).rounded(.up)))
            await opts.onProgress(HumProgress(phase: .count, beat: left, take: nil, start: start, stepSeconds: step))
        } else if now < end {
            let barNumber = Int(((now - start) / bar).rounded(.down)) + 1
            await opts.onProgress(HumProgress(phase: .hum, beat: barNumber, take: fit(upTo: now), start: start, stepSeconds: step))
        }
    }

    let take = fit(upTo: end)
    if take.pattern.notes.isEmpty {
        throw HumError("Didn't hear a tune. Hum closer to the Mac, or sing “da da da”.")
    }
    player.loadFrom(take.pattern, origin: start)
    handed = true
    await opts.onProgress(HumProgress(phase: .done, beat: 0, take: take, start: start, stepSeconds: step))
    return take
}
