// The loop player on a fake clock: the tests move time by hand and call
// `tick()` themselves, then read what the player handed a recording sink.
// Most run at 240 bpm, where a step is 1/16 s and a bar is a second, so the
// times are easy to check by eye. The player starts 0.06 s after `start()`.

import XCTest
@testable import Op1Core

/// A clock the test sets.
final class FakeClock: JamClock, @unchecked Sendable {
    var time: TimeInterval = 0
    func now() -> TimeInterval { time }
}

/// Keeps every message with its timestamp.
final class RecordingSink: MIDISink {
    struct Message: Equatable {
        var bytes: [UInt8]
        var time: TimeInterval
    }
    var messages: [Message] = []

    func send(_ bytes: [UInt8], at time: TimeInterval) {
        messages.append(Message(bytes: bytes, time: time))
    }

    /// Note-ons for `note` (any note when nil), in the order they were sent.
    func noteOns(_ note: Int? = nil) -> [Message] {
        messages.filter { $0.bytes.count == 3 && $0.bytes[0] & 0xf0 == 0x90 && (note == nil || Int($0.bytes[1]) == note) }
    }

    func noteOffs(_ note: Int? = nil) -> [Message] {
        messages.filter { $0.bytes.count == 3 && $0.bytes[0] & 0xf0 == 0x80 && (note == nil || Int($0.bytes[1]) == note) }
    }

    func times(of bytes: [UInt8]) -> [TimeInterval] {
        messages.filter { $0.bytes == bytes }.map { $0.time }
    }
}

final class PlayerTests: XCTestCase {
    var clock: FakeClock!
    var sink: RecordingSink!
    var player: Player!
    var loops: [(loop: Int, pattern: Pattern?, swapped: Bool)] = []

    override func setUp() {
        super.setUp()
        clock = FakeClock()
        sink = RecordingSink()
        loops = []
        player = Player(
            clock: clock,
            events: PlayerEvents(onLoop: { [weak self] loop, pattern, swapped in
                self?.loops.append((loop, pattern, swapped))
            }),
            runsTimer: false)
        player.setOutput(sink)
        player.setTempo(240)
        player.setIdleBars(.one)
    }

    /// Move the clock to `until` the way the timer would, a tick at a time.
    func run(until: TimeInterval) {
        while clock.time < until {
            clock.time = min(until, clock.time + 0.025)
            player.tick()
        }
    }

    func one(_ notes: [PatternNote]) -> Pattern { Pattern(bars: .one, notes: notes) }

    func assertTimes(_ got: [TimeInterval], _ want: [TimeInterval], file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(got.count, want.count, "times \(got) vs \(want)", file: file, line: line)
        for (g, w) in zip(got, want) {
            XCTAssertEqual(g, w, accuracy: 1e-9, file: file, line: line)
        }
    }

    // MARK: Notes

    func testNotesAreStampedOnTheGridAndGated() {
        player.load(one([PatternNote(step: 0, note: 60, length: 2), PatternNote(step: 4, note: 64, length: 1)]))
        player.start()
        run(until: 0.9)
        // Step 0 at 0.06, step 4 four sixteenths later; each note-off at
        // nine tenths of the note's length.
        assertTimes(sink.noteOns(60).map { $0.time }, [0.06])
        assertTimes(sink.noteOffs(60).map { $0.time }, [0.06 + 2 * 0.0625 * 0.9])
        assertTimes(sink.noteOns(64).map { $0.time }, [0.06 + 4 * 0.0625])
        assertTimes(sink.noteOffs(64).map { $0.time }, [0.06 + 4 * 0.0625 + 0.0625 * 0.9])
        XCTAssertEqual(sink.noteOns(60).first?.bytes, [0x90, 60, 100])
        XCTAssertEqual(sink.noteOffs(60).first?.bytes, [0x80, 60, 0])
        XCTAssertEqual(player.stepSeconds(), 0.0625, accuracy: 1e-12)
    }

    func testNotesFollowTheTempoAndChannel() {
        player.setTempo(120)
        player.setChannel(3)
        player.load(one([PatternNote(step: 2, note: 48, length: 1)]))
        player.start()
        run(until: 0.5)
        assertTimes(sink.noteOns(48).map { $0.time }, [0.06 + 2 * 0.125])
        XCTAssertEqual(sink.noteOns(48).first?.bytes, [0x92, 48, 100])
        XCTAssertEqual(sink.noteOffs(48).first?.bytes, [0x82, 48, 0])
    }

    func testTheLoopRepeats() {
        player.load(one([PatternNote(step: 0, note: 60, length: 1)]))
        player.start()
        run(until: 2.5)
        assertTimes(sink.noteOns(60).map { $0.time }, [0.06, 1.06, 2.06])
    }

    func testRepeatedNotesAreCutShortOfTheNextOne() {
        // A note that claims the whole bar gives way to the same key at step 4.
        player.load(one([PatternNote(step: 0, note: 60, length: 16), PatternNote(step: 4, note: 60, length: 1)]))
        player.start()
        run(until: 0.9)
        assertTimes(sink.noteOffs(60).map { $0.time }, [0.06 + 4 * 0.0625 * 0.9, 0.06 + 4 * 0.0625 + 0.0625 * 0.9])
    }

    func testNothingIsSentWithoutAnOutput() {
        let silent = Player(clock: clock, runsTimer: false)
        silent.load(one([PatternNote(step: 0, note: 60, length: 1)]))
        silent.start()
        XCTAssertFalse(silent.playing)
        silent.testNotes()
    }

    // MARK: Loading

    func testStoppedLoadReplacesAtOnce() {
        let a = one([PatternNote(step: 0, note: 60, length: 1)])
        player.load(a)
        XCTAssertEqual(player.current, a)
        XCTAssertNil(player.waiting)
    }

    func testLoadWhilePlayingWaitsForTheTopOfTheLoop() {
        let a = one([PatternNote(step: 0, note: 60, length: 1)])
        let b = one([PatternNote(step: 0, note: 62, length: 1)])
        player.load(a)
        player.start()
        run(until: 0.3)
        player.load(b)
        XCTAssertEqual(player.current, a)
        XCTAssertEqual(player.waiting, b)
        run(until: 1.5)
        assertTimes(sink.noteOns(60).map { $0.time }, [0.06])
        assertTimes(sink.noteOns(62).map { $0.time }, [1.06])
        XCTAssertEqual(player.current, b)
        XCTAssertNil(player.waiting)
    }

    func testCancelPendingDropsTheWaitingPattern() {
        let a = one([PatternNote(step: 0, note: 60, length: 1)])
        player.load(a)
        player.start()
        run(until: 0.3)
        player.load(one([PatternNote(step: 0, note: 62, length: 1)]))
        player.cancelPending()
        run(until: 1.5)
        XCTAssertEqual(sink.noteOns(62).count, 0)
        assertTimes(sink.noteOns(60).map { $0.time }, [0.06, 1.06])
    }

    func testLoadFromPlacesThePatternInItsOwnLoop() {
        player.start()
        run(until: 0.3)
        // As though the loop had begun four steps before the player did:
        // step 8 of this pattern falls at origin + 8 steps, every bar.
        let origin = 0.06 - 4 * 0.0625
        player.loadFrom(one([PatternNote(step: 8, note: 62, length: 1)]), origin: origin)
        run(until: 2.0)
        assertTimes(sink.noteOns(62).map { $0.time }, [origin + 24 * 0.0625])
        XCTAssertNil(player.waiting)
        // The playhead follows the new loop's numbering too.
        XCTAssertEqual(player.positionAt(1.32)?.step, 8)
    }

    func testLoadFromWhileStoppedJustLoads() {
        let a = one([PatternNote(step: 0, note: 60, length: 1)])
        player.loadFrom(a, origin: 5)
        XCTAssertEqual(player.current, a)
        XCTAssertNil(player.waiting)
    }

    func testMutedLoopKeepsTimeAndSwapsOnTheBarLine() {
        let two = Pattern(bars: .two, notes: [PatternNote(step: 0, note: 60, length: 1), PatternNote(step: 16, note: 61, length: 1)])
        player.load(two)
        player.start()
        run(until: 0.3)
        player.setMuted(true)
        run(until: 0.9)
        // The loop kept its place while silent.
        XCTAssertEqual(player.positionAt(0.9)?.step, 13)
        // A new pattern starts at the next bar line, not the top of the loop.
        player.load(one([PatternNote(step: 0, note: 62, length: 1)]))
        run(until: 1.5)
        XCTAssertEqual(sink.noteOns(61).count, 0)
        assertTimes(sink.noteOns(62).map { $0.time }, [1.06])
        XCTAssertEqual(player.positionAt(1.5)?.step, 7, "and counts from its own top")
    }

    func testStopKeepsAPatternThatArrivedTooLate() {
        let a = one([PatternNote(step: 0, note: 60, length: 1)])
        let b = one([PatternNote(step: 0, note: 62, length: 1)])
        player.load(a)
        player.start()
        run(until: 0.3)
        player.load(b)
        player.stop()
        XCTAssertEqual(player.current, b)
        XCTAssertNil(player.waiting)
        XCTAssertFalse(player.playing)
    }

    func testClearForgetsThePattern() {
        player.load(one([PatternNote(step: 0, note: 60, length: 1)]))
        player.clear()
        XCTAssertNil(player.current)
        player.start()
        run(until: 1.0)
        XCTAssertEqual(sink.noteOns().count, 0)
    }

    // MARK: MIDI clock

    func testMidiClockSendsStartPulsesAndStop() {
        player.setClock(true)
        player.start()
        XCTAssertTrue(player.playing)
        assertTimes(sink.times(of: [0xfa]), [0.06 - 0.001])
        run(until: 1.0)
        let pulses = sink.times(of: [0xf8]).filter { $0 < 1.06 - 1e-9 }
        XCTAssertEqual(pulses.count, 24 * 4, "24 pulses a beat over one bar")
        XCTAssertEqual(pulses[0], 0.06, accuracy: 1e-9)
        XCTAssertEqual(pulses[1], 0.06 + 0.0625 / 6, accuracy: 1e-9)
        XCTAssertEqual(pulses[6], 0.06 + 0.0625, accuracy: 1e-9)
        // Start goes out just before the first pulse, so a receiver starts on it.
        XCTAssertLessThan(sink.times(of: [0xfa])[0], pulses[0])
        clock.time = 1.0
        player.stop()
        let last = sink.times(of: [0xf8]).max()!
        let stops = sink.times(of: [0xfc])
        XCTAssertEqual(stops.count, 1)
        XCTAssertGreaterThan(stops[0], last)
        XCTAssertGreaterThanOrEqual(stops[0], 1.0)
    }

    func testNoClockWhenOff() {
        player.start()
        run(until: 1.0)
        player.stop()
        XCTAssertEqual(sink.times(of: [0xfa]).count, 0)
        XCTAssertEqual(sink.times(of: [0xf8]).count, 0)
        XCTAssertEqual(sink.times(of: [0xfc]).count, 0)
    }

    // MARK: Echo and the out light

    func testIsEchoWithinFortyMilliseconds() {
        player.load(one([PatternNote(step: 0, note: 60, length: 1)]))
        player.start()
        run(until: 0.1)
        XCTAssertTrue(player.isEcho(60, 0.06))
        XCTAssertTrue(player.isEcho(60, 0.06 + 0.039))
        XCTAssertTrue(player.isEcho(60, 0.06 - 0.039))
        XCTAssertFalse(player.isEcho(60, 0.06 + 0.041))
        XCTAssertFalse(player.isEcho(61, 0.06))
        // A second later it is forgotten.
        run(until: 1.5)
        XCTAssertFalse(player.isEcho(60, 0.06))
        XCTAssertTrue(player.isEcho(60, 1.06))
    }

    func testSoundingAt() {
        player.load(one([PatternNote(step: 0, note: 60, length: 2)]))
        player.start()
        run(until: 0.1)
        XCTAssertFalse(player.soundingAt(0.05))
        XCTAssertTrue(player.soundingAt(0.06))
        XCTAssertTrue(player.soundingAt(0.15))
        XCTAssertFalse(player.soundingAt(0.06 + 2 * 0.0625 * 0.9))
    }

    // MARK: The click

    func testClickSoundsOnBeatsBetweenFromAndUntil() {
        player.start()
        run(until: 0.5)
        player.setClick(from: 1.0, until: 2.0)
        run(until: 2.5)
        // Beats at 1.06, 1.31, 1.56, 1.81 fall in the window; 2.06 doesn't.
        assertTimes(sink.noteOns().map { $0.time }, [1.06, 1.31, 1.56, 1.81])
        XCTAssertEqual(sink.noteOns().map { Int($0.bytes[1]) }, [84, 79, 79, 79], "accent on the bar line")
        assertTimes(sink.noteOffs().map { $0.time }, [1.10, 1.35, 1.60, 1.85])
    }

    func testClickIsForgottenOnStop() {
        player.start()
        player.setClick(from: 0, until: 10)
        run(until: 0.5)
        player.stop()
        let before = sink.noteOns().count
        XCTAssertGreaterThan(before, 0)
        clock.time = 1.0
        player.start()
        run(until: 2.0)
        XCTAssertEqual(sink.noteOns().count, before)
    }

    // MARK: Test notes

    func testTestNotesSendThreeRisingNotes() {
        clock.time = 0.5
        player.testNotes()
        XCTAssertEqual(sink.noteOns().map { Int($0.bytes[1]) }, [60, 64, 67])
        assertTimes(sink.noteOns().map { $0.time }, [0.52, 0.70, 0.88])
        assertTimes(sink.noteOffs().map { $0.time }, [0.52 + 0.16, 0.70 + 0.16, 0.88 + 0.16])
        XCTAssertTrue(player.soundingAt(0.6))
        XCTAssertFalse(player.playing)
    }

    // MARK: Stopping

    func testStopReleasesSoundingNotes() {
        player.load(one([PatternNote(step: 0, note: 60, length: 16)]))
        player.start()
        run(until: 0.3)
        // The note-off for the whole-bar note was already stamped for 0.96;
        // stopping sends another right now.
        assertTimes(sink.noteOffs(60).map { $0.time }, [0.06 + 16 * 0.0625 * 0.9])
        player.stop()
        assertTimes(sink.noteOffs(60).map { $0.time }, [0.06 + 16 * 0.0625 * 0.9, 0.3])
        XCTAssertFalse(player.soundingAt(0.4))
        XCTAssertFalse(player.playing)
        XCTAssertNil(player.positionAt(0.2))
    }

    func testStopReleasesANoteStampedJustAhead() {
        player.load(one([PatternNote(step: 0, note: 60, length: 1)]))
        clock.time = 1.0
        player.start()
        // The note-on is stamped for 1.06; a note-off now would arrive first.
        player.stop()
        let offs = sink.noteOffs(60).map { $0.time }
        XCTAssertEqual(offs.count, 2)
        XCTAssertEqual(offs[1], 1.061, accuracy: 1e-9)
    }

    func testChangingOutputReleasesNotes() {
        player.load(one([PatternNote(step: 0, note: 60, length: 16)]))
        player.start()
        run(until: 0.3)
        let other = RecordingSink()
        player.setOutput(other)
        XCTAssertEqual(sink.noteOffs(60).count, 2, "released on the old output")
        XCTAssertEqual(other.messages.count, 0)
    }

    // MARK: Where the loop is

    func testPositionLocateAndBarAfter() {
        XCTAssertNil(player.positionAt(0))
        XCTAssertNil(player.locate(0))
        XCTAssertNil(player.barAfter(0))
        player.start()
        run(until: 0.5)
        XCTAssertEqual(player.positionAt(0.2), StepMark(time: 0.06 + 2 * 0.0625, loop: 0, step: 2))
        XCTAssertNil(player.positionAt(0.05))
        XCTAssertEqual(player.locate(0.19)?.step, 2)
        XCTAssertEqual(player.locate(0.22)?.step, 3, "a hair early lands on the step it was meant for")
        XCTAssertNil(player.locate(-5))
        XCTAssertEqual(player.barAfter(0.5)!, 1.06, accuracy: 1e-9)
        XCTAssertEqual(player.barAfter(1.05)!, 1.06, accuracy: 1e-9)
        XCTAssertEqual(player.barAfter(1.07)!, 2.06, accuracy: 1e-9)
        XCTAssertEqual(player.loopNow, 0)
        run(until: 1.5)
        XCTAssertEqual(player.loopNow, 1)
    }

    func testStallSkipsTheBacklog() {
        player.load(one([PatternNote(step: 0, note: 60, length: 1)]))
        player.start()
        run(until: 0.1)
        // The Mac slept for five seconds: the loop picks up from now rather
        // than playing twenty steps at once.
        clock.time = 5.0
        player.tick()
        let late = sink.noteOns().filter { $0.time > 0.2 }
        XCTAssertTrue(late.allSatisfy { $0.time >= 5.0 }, "\(late)")
    }

    // MARK: Loop events

    func testOnLoopFiresWhenTheTopSoundsOnTheMainQueue() {
        let a = one([PatternNote(step: 0, note: 60, length: 1)])
        let b = one([PatternNote(step: 0, note: 62, length: 1)])
        player.load(a)
        player.start()
        run(until: 0.3)
        player.load(b)
        run(until: 1.5)
        // Nothing has reached the main queue until it is drained.
        let drained = expectation(description: "loop events delivered")
        DispatchQueue.main.async { drained.fulfill() }
        wait(for: [drained], timeout: 2)
        XCTAssertEqual(loops.map { $0.loop }, [0, 1])
        XCTAssertEqual(loops.map { $0.swapped }, [false, true])
        XCTAssertEqual(loops[0].pattern, a)
        XCTAssertEqual(loops[1].pattern, b)
    }

    func testOnLoopWaitsUntilTheTopActuallySounds() {
        player.load(one([PatternNote(step: 0, note: 60, length: 1)]))
        player.start()
        // The top was scheduled for 0.06 but hasn't sounded yet.
        clock.time = 0.05
        player.tick()
        let first = expectation(description: "first drain")
        DispatchQueue.main.async { first.fulfill() }
        wait(for: [first], timeout: 2)
        XCTAssertEqual(loops.count, 0)
        clock.time = 0.07
        player.tick()
        let second = expectation(description: "second drain")
        DispatchQueue.main.async { second.fulfill() }
        wait(for: [second], timeout: 2)
        XCTAssertEqual(loops.count, 1)
    }

    // MARK: The real timer

    func testTheTimerTicksOnItsOwn() {
        // With the timer on, a real clock and no help from the test, notes
        // keep coming.
        final class RealClock: JamClock {
            func now() -> TimeInterval { Date().timeIntervalSinceReferenceDate }
        }
        let live = Player(clock: RealClock())
        live.setOutput(sink)
        live.setTempo(240)
        live.load(one([PatternNote(step: 0, note: 60, length: 1), PatternNote(step: 8, note: 62, length: 1)]))
        live.start()
        let done = expectation(description: "a few steps went by")
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.7) { done.fulfill() }
        wait(for: [done], timeout: 5)
        live.stop()
        XCTAssertFalse(live.playing)
        XCTAssertGreaterThanOrEqual(sink.noteOns(62).count, 1)
    }
}
