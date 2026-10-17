// The loop player. It keeps time in the app and sends notes to the OP-1
// with timestamps on the JamClock, so the timing doesn't depend on Claude,
// on the window, or on how busy the app is. A port of
// src/renderer/jam/player.ts in the Electron app, with two changes: times
// are seconds on the JamClock rather than milliseconds, and MIDI goes to a
// MIDISink rather than a Web MIDI port.
//
// The method is the usual one for steady timing: a timer wakes every `tickInterval`
// seconds and hands the sink every note due in the next `lookahead`, each
// stamped with the exact moment it should sound. The sink sends it at that
// moment, whatever the app is doing. A late wake-up only shrinks the margin;
// the notes stay where they were stamped.
//
// Threads: the timer ticks on its own serial queue while the app calls the
// public methods from the main thread. One lock guards all of the player's
// state, every public method and `tick` take it, and nothing is called out
// to while it is held except the sink, which only queues bytes. The onLoop
// callback is handed to the main queue after the lock is released.

import Foundation

/// How often the timer wakes, in seconds.
private let tickInterval = 0.025
/// How far ahead of now notes are handed to the sink, in seconds.
private let lookahead = 0.12
/// How much of its length a note sounds, so repeated notes re-trigger.
private let gate = 0.9
/// The OP-1's keys send no velocity, so neither does the app.
private let velocity: UInt8 = 100
/// MIDI clock runs at 24 ticks to a beat: six to a sixteenth-note step.
private let clocksPerStep = 6
/// Notes the OP-1 sends back within this long of one the app sent are the app's own.
private let echo = 0.04
/// Enough step marks to place a note played a few loops ago.
private let maxMarks = 1024
/// The click: a high note on each beat, higher on the bar line, kept short.
private let clickAccent = 84
private let clickBeat = 79
private let clickLength = 0.04

/// A scheduled step: when it sounds, and where it is in which loop.
public struct StepMark: Equatable, Sendable {
    public var time: TimeInterval
    public var loop: Int
    public var step: Int

    public init(time: TimeInterval, loop: Int, step: Int) {
        self.time = time
        self.loop = loop
        self.step = step
    }
}

public struct PlayerEvents {
    /// The top of a loop, fired when it sounds rather than when it was
    /// scheduled, on the main queue. `swapped` says a waiting pattern started here.
    public var onLoop: ((_ loop: Int, _ pattern: Pattern?, _ swapped: Bool) -> Void)?

    public init(onLoop: ((Int, Pattern?, Bool) -> Void)? = nil) {
        self.onLoop = onLoop
    }
}

public final class Player {
    private struct Sounding {
        var channel: UInt8
        var note: Int
        var on: TimeInterval
        var off: TimeInterval
    }

    private struct Sent {
        var note: Int
        var time: TimeInterval
    }

    /// A note at its start step, with how long it may hold.
    private struct Hold {
        var note: Int
        var hold: Int
    }

    private struct LoopEvent {
        var time: TimeInterval
        var loop: Int
        var pattern: Pattern?
        var swapped: Bool
    }

    private let clock: JamClock
    private let events: PlayerEvents
    /// Off in tests, which call `tick()` themselves with a fake clock.
    private let runsTimer: Bool
    private let lock = NSLock()
    private let queue = DispatchQueue(label: "op1jam.player")

    private var output: MIDISink?
    private var channel: UInt8 = 0
    private var tempo = 120.0
    private var sendClock = false
    private var idleBars: LoopBars = .two

    private var pattern: Pattern?
    private var prepared: [Int: [Hold]] = [:]
    private var pending: Pattern?
    /// Set when the waiting pattern starts mid-loop: the moment its loop began.
    private var pendingOrigin: TimeInterval?
    /// While muted the loop keeps time but plays none of its notes.
    private var muted = false
    /// Click on each beat scheduled from `from` until just before `until`.
    private var click = (from: Double.infinity, until: -Double.infinity)

    private var ticker: DispatchSourceTimer?
    private var running = false
    private var nextStepTime: TimeInterval = 0
    private var step = 0
    private var loop = -1
    private var lastClock: TimeInterval = 0

    private var sounding: [Sounding] = []
    private var sent: [Sent] = []
    private var marks: [StepMark] = []
    private var loopEvents: [LoopEvent] = []

    public init(clock: JamClock, events: PlayerEvents = PlayerEvents(), runsTimer: Bool = true) {
        self.clock = clock
        self.events = events
        self.runsTimer = runsTimer
    }

    deinit {
        ticker?.cancel()
    }

    // MARK: - Settings

    public func setOutput(_ output: MIDISink?) {
        lock.lock()
        defer { lock.unlock() }
        if output === self.output { return }
        release(clock.now())
        self.output = output
    }

    /// 1–16, as the OP-1 shows it.
    public func setChannel(_ channel: Int) {
        lock.lock()
        defer { lock.unlock() }
        self.channel = UInt8(min(15, max(0, channel - 1)))
    }

    public func setTempo(_ bpm: Double) {
        lock.lock()
        defer { lock.unlock() }
        tempo = min(240, max(40, bpm))
    }

    /// Send MIDI clock, start and stop, so the OP-1 can follow the app's tempo.
    public func setClock(_ on: Bool) {
        lock.lock()
        defer { lock.unlock() }
        sendClock = on
    }

    /// Loop length while there is no pattern yet.
    public func setIdleBars(_ bars: LoopBars) {
        lock.lock()
        defer { lock.unlock() }
        idleBars = bars
    }

    public var playing: Bool {
        lock.lock()
        defer { lock.unlock() }
        return running
    }

    public var current: Pattern? {
        lock.lock()
        defer { lock.unlock() }
        return pattern
    }

    public var waiting: Pattern? {
        lock.lock()
        defer { lock.unlock() }
        return pending
    }

    /// Hand the player a new pattern. Stopped, it replaces the old one at
    /// once; playing, it waits for the top of the loop — or the next bar
    /// line, if nothing is playing yet — so the change lands on the beat.
    public func load(_ pattern: Pattern) {
        lock.lock()
        defer { lock.unlock() }
        loadLocked(pattern)
    }

    private func loadLocked(_ pattern: Pattern) {
        pendingOrigin = nil
        if !running {
            use(pattern)
            pending = nil
        } else {
            pending = pattern
        }
    }

    /// Start a pattern on the next step, as though its loop had begun at
    /// `origin` and been playing since: a hummed take picks up where the
    /// tune would be, rather than waiting for the top of a loop.
    public func loadFrom(_ pattern: Pattern, origin: TimeInterval) {
        lock.lock()
        defer { lock.unlock() }
        if !running {
            loadLocked(pattern)
            return
        }
        pending = pattern
        pendingOrigin = origin
    }

    /// Drop a pattern waiting for the top of the loop.
    public func cancelPending() {
        lock.lock()
        defer { lock.unlock() }
        pending = nil
        pendingOrigin = nil
    }

    /// Silence the pattern while keeping time, as while the person hums. It
    /// stays muted until a new pattern takes over, which then starts at the
    /// next bar line instead of waiting for the top of the loop.
    public func setMuted(_ muted: Bool) {
        lock.lock()
        defer { lock.unlock() }
        self.muted = muted
    }

    /// Tick each beat on the OP-1 between two moments on the JamClock.
    public func setClick(from: TimeInterval, until: TimeInterval) {
        lock.lock()
        defer { lock.unlock() }
        click = (from: from, until: until)
    }

    /// Forget the pattern, as on a fresh start.
    public func clear() {
        lock.lock()
        defer { lock.unlock() }
        pattern = nil
        prepared = [:]
        pending = nil
    }

    // MARK: - Transport

    public func start() {
        lock.lock()
        if running || output == nil {
            lock.unlock()
            return
        }
        let t0 = clock.now() + 0.06
        nextStepTime = t0
        step = 0
        loop = -1
        marks = []
        // A receiver starts on the first clock after Start.
        if sendClock { output?.send([0xfa], at: t0 - 0.001) }
        running = true
        if runsTimer {
            let timer = DispatchSource.makeTimerSource(queue: queue)
            timer.schedule(deadline: .now() + tickInterval, repeating: tickInterval, leeway: .milliseconds(2))
            timer.setEventHandler { [weak self] in self?.tick() }
            timer.resume()
            ticker = timer
        }
        lock.unlock()
        tick()
    }

    public func stop() {
        lock.lock()
        defer { lock.unlock() }
        if !running { return }
        ticker?.cancel()
        ticker = nil
        running = false
        let now = clock.now()
        release(now)
        if sendClock { output?.send([0xfc], at: max(now, lastClock + 0.001)) }
        marks = []
        loopEvents = []
        loop = -1
        step = 0
        muted = false
        click = (from: Double.infinity, until: -Double.infinity)
        // A pattern that arrived too late to play becomes the one shown and kept.
        if let next = pending {
            use(next)
            pending = nil
            pendingOrigin = nil
        }
    }

    // MARK: - Where the loop is

    /// The step sounding at `time`, for the playhead.
    public func positionAt(_ time: TimeInterval) -> StepMark? {
        lock.lock()
        defer { lock.unlock() }
        return positionAtLocked(time)
    }

    private func positionAtLocked(_ time: TimeInterval) -> StepMark? {
        for mark in marks.reversed() where mark.time <= time {
            return mark
        }
        return nil
    }

    /// The loop number sounding now.
    public var loopNow: Int {
        lock.lock()
        defer { lock.unlock() }
        return positionAtLocked(clock.now())?.loop ?? loop
    }

    /// Which step a moment falls on: the nearest scheduled step, so a note
    /// played a hair early lands on the beat it was meant for. Nil when the
    /// loop wasn't running then.
    public func locate(_ time: TimeInterval) -> StepMark? {
        lock.lock()
        defer { lock.unlock() }
        if marks.isEmpty { return nil }
        let seconds = stepSecondsLocked()
        var best: StepMark?
        var gap = Double.infinity
        for mark in marks {
            let d = abs(mark.time - time)
            if d < gap {
                gap = d
                best = mark
            }
        }
        return gap <= seconds ? best : nil
    }

    /// Three rising notes (C, E, G around middle C) on the current channel,
    /// to check the OP-1 is listening before Claude is involved. Works
    /// stopped or playing.
    public func testNotes() {
        lock.lock()
        defer { lock.unlock() }
        if output == nil { return }
        let now = clock.now()
        sounding = sounding.filter { $0.off > now }
        for (i, note) in [60, 64, 67].enumerated() {
            play(note, at: now + 0.02 + Double(i) * 0.18, for: 0.16)
        }
    }

    /// Whether the app has a note sounding at `time`, for the "out" light.
    public func soundingAt(_ time: TimeInterval) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return sounding.contains { $0.on <= time && $0.off > time }
    }

    /// Whether a note coming back from the OP-1 is one the app just sent.
    public func isEcho(_ note: Int, _ time: TimeInterval) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return sent.contains { $0.note == note && abs($0.time - time) < echo }
    }

    /// One sixteenth-note step at the current tempo, in seconds.
    public func stepSeconds() -> TimeInterval {
        lock.lock()
        defer { lock.unlock() }
        return stepSecondsLocked()
    }

    private func stepSecondsLocked() -> TimeInterval {
        60 / tempo / 4
    }

    /// When the first bar line at or after `time` sounds, counting on from
    /// the steps already scheduled. Nil when stopped. Assumes the tempo and
    /// loop stay as they are until then.
    public func barAfter(_ time: TimeInterval) -> TimeInterval? {
        lock.lock()
        defer { lock.unlock() }
        guard running, let last = marks.last else { return nil }
        let seconds = stepSecondsLocked()
        let total = loopSteps()
        var t = last.time
        var step = last.step
        while t < time || step % stepsPerBar != 0 {
            t += seconds
            step = (step + 1) % total
        }
        return t
    }

    // MARK: - Scheduling

    /// One wake of the timer. Internal so tests can drive it with a fake clock.
    func tick() {
        lock.lock()
        if !running {
            lock.unlock()
            return
        }
        let now = clock.now()
        let horizon = now + lookahead
        while nextStepTime < horizon {
            // After a stall (a sleeping Mac) don't play the backlog all at
            // once: skip to now and carry on from there.
            if nextStepTime < now - lookahead { nextStepTime = now }
            let seconds = stepSecondsLocked()
            scheduleStep(nextStepTime, seconds)
            nextStepTime += seconds
        }
        var due: [LoopEvent] = []
        while let first = loopEvents.first, first.time <= now {
            due.append(first)
            loopEvents.removeFirst()
        }
        sounding = sounding.filter { $0.off > now }
        sent = sent.filter { $0.time > now - 1 }
        if marks.count > maxMarks { marks.removeFirst(marks.count - maxMarks) }
        lock.unlock()

        guard let onLoop = events.onLoop else { return }
        for e in due {
            DispatchQueue.main.async { onLoop(e.loop, e.pattern, e.swapped) }
        }
    }

    private func scheduleStep(_ t: TimeInterval, _ seconds: TimeInterval) {
        if let next = pending, let origin = pendingOrigin {
            use(next)
            let total = loopSteps()
            let at = Int(((t - origin) / seconds).rounded())
            step = ((at % total) + total) % total
            pending = nil
            pendingOrigin = nil
            muted = false
            // Mid-loop there's no top of the loop to announce; the next one is.
            if step != 0 { loopEvents.append(LoopEvent(time: t, loop: loop, pattern: pattern, swapped: true)) }
        }

        let silent = pattern == nil || pattern!.notes.isEmpty
        let swap = pending != nil && (step == 0 || ((silent || muted) && step % stepsPerBar == 0))
        if swap, let next = pending {
            use(next)
            pending = nil
            muted = false
            step = 0
        }

        if step == 0 {
            loop += 1
            loopEvents.append(LoopEvent(time: t, loop: loop, pattern: pattern, swapped: swap))
        }

        marks.append(StepMark(time: t, loop: loop, step: step))

        if !muted {
            for n in prepared[step] ?? [] {
                play(n.note, at: t, for: max(0.01, Double(n.hold) * seconds * gate))
            }
        }
        if step % 4 == 0 && t >= click.from - 0.001 && t < click.until - 0.001 {
            play(step % stepsPerBar == 0 ? clickAccent : clickBeat, at: t, for: clickLength)
        }

        if sendClock, let output = output {
            for i in 0..<clocksPerStep {
                lastClock = t + Double(i) * seconds / Double(clocksPerStep)
                output.send([0xf8], at: lastClock)
            }
        }

        step += 1
        if step >= loopSteps() { step = 0 }
    }

    private func play(_ note: Int, at t: TimeInterval, for duration: TimeInterval) {
        guard let output = output else { return }
        let ch = channel
        let key = UInt8(min(127, max(0, note)))
        output.send([0x90 | ch, key, velocity], at: t)
        output.send([0x80 | ch, key, 0], at: t + duration)
        sounding.append(Sounding(channel: ch, note: note, on: t, off: t + duration))
        sent.append(Sent(note: note, time: t))
    }

    /// Silence everything already handed to the sink. A note-on stamped for
    /// the next few milliseconds can't be taken back, so its note-off goes
    /// out just after it rather than now.
    private func release(_ now: TimeInterval) {
        guard let output = output else { return }
        for s in sounding where s.off > now {
            let key = UInt8(min(127, max(0, s.note)))
            output.send([0x80 | s.channel, key, 0], at: max(now, s.on + 0.001))
        }
        sounding = []
    }

    private func loopSteps() -> Int {
        (pattern?.bars ?? idleBars).steps
    }

    /// Index the pattern by start step, and cut each note short of the next
    /// note on the same key, so one note's release never lands on the next
    /// one's start and silences it.
    private func use(_ pattern: Pattern) {
        let total = pattern.bars.steps
        var prepared: [Int: [Hold]] = [:]
        for (i, n) in pattern.notes.enumerated() {
            var gap = total
            for (j, m) in pattern.notes.enumerated() {
                if j == i || m.note != n.note { continue }
                let ahead = (m.step - n.step + total) % total
                if ahead > 0 && ahead < gap { gap = ahead }
            }
            prepared[n.step, default: []].append(Hold(note: n.note, hold: min(n.length, gap)))
        }
        self.pattern = pattern
        self.prepared = prepared
    }
}
