// Turning a hum into a loop, on synthetic voices. A port of tests/hum.test.ts
// in the Electron app, with times in seconds instead of milliseconds.

import XCTest
@testable import Op1Core

final class HumTests: XCTestCase {
    let sampleRate = 24000.0
    let window = 1024
    let hop = 256

    struct Sung {
        var at: Double
        var dur: Double
        var midi: Int
    }

    func midiHz(_ m: Int) -> Double {
        440 * pow(2, Double(m - 69) / 12)
    }

    /// A hum-like voice: a fundamental with a few overtones, a little vibrato, some noise.
    func voice(_ notes: [Sung], seconds: Double, seed: Int = 1) -> [Float] {
        var out = [Float](repeating: 0, count: Int((seconds * sampleRate).rounded(.up)))
        var rand = seed
        func noise() -> Double {
            rand = (rand * 16807) % 2147483647
            return (Double(rand) / 2147483647 - 0.5) * 0.004
        }
        var phase = 0.0
        for i in 0..<out.count {
            let t = Double(i) / sampleRate
            var sample = noise()
            if let n = notes.first(where: { t >= $0.at && t < $0.at + $0.dur }) {
                let hz = midiHz(n.midi) * (1 + 0.004 * sin(2 * Double.pi * 5.5 * t))
                phase += (2 * Double.pi * hz) / sampleRate
                let env = min(1, (t - n.at) / 0.02, (n.at + n.dur - t) / 0.02)
                sample += env * 0.2 * (sin(phase) + 0.5 * sin(2 * phase) + 0.25 * sin(3 * phase))
            }
            out[i] = Float(sample)
        }
        return out
    }

    /// The mic's readings of a recording, as the app makes them.
    func frames(_ audio: [Float]) -> [HumFrame] {
        var out: [HumFrame] = []
        var i = 0
        while i + window <= audio.count {
            let buf = Array(audio[i..<(i + window)])
            let p = detectPitch(buf, sampleRate: sampleRate)
            var midi: Double? = nil
            if let p = p, p.clarity > 0.6 { midi = hzToMidi(p.hz) }
            out.append(HumFrame(time: Double(i + window / 2) / sampleRate, level: level(buf), midi: midi))
            i += hop
        }
        return out
    }

    // MARK: pitch

    func testHearsSungNotesAtTheirPitch() {
        for m in [40, 48, 57, 69, 81] {
            let buf = Array(voice([Sung(at: 0, dur: 1, midi: m)], seconds: 0.1)[0..<window])
            let p = detectPitch(buf, sampleRate: sampleRate)
            XCTAssertNotNil(p, "hears \(m)")
            if let p = p {
                XCTAssertEqual(Int(hzToMidi(p.hz).rounded()), m, "hears \(m) as \(m)")
            }
        }
    }

    func testSilenceHasNoPitch() {
        XCTAssertNil(detectPitch([Float](repeating: 0, count: window), sampleRate: sampleRate))
    }

    func testHzToMidi() {
        XCTAssertEqual(hzToMidi(440), 69, accuracy: 1e-9)
        XCTAssertEqual(hzToMidi(220), 57, accuracy: 1e-9)
    }

    // MARK: notes

    // 120 BPM: a step is 125 ms. "da da da": D4 E4 F4, an eighth each with a gap, then A4 held a beat.
    let tune = [
        Sung(at: 0.5, dur: 0.22, midi: 62),
        Sung(at: 0.75, dur: 0.22, midi: 64),
        Sung(at: 1.0, dur: 0.22, midi: 65),
        Sung(at: 1.25, dur: 0.48, midi: 69),
    ]

    func testSegmentsASungTuneIntoNotes() {
        let heard = frames(voice(tune, seconds: 2))
        let gate = noiseGate(heard.filter { $0.time < 0.4 })
        let raw = segment(heard, gate: gate)
        XCTAssertEqual(raw.count, 4, "four notes")
        XCTAssertEqual(raw.map { Int($0.pitch.rounded()) }, [62, 64, 65, 69], "at the right pitches")
        for (r, sung) in zip(raw, tune) {
            XCTAssertLessThan(abs(r.start - sung.at), 0.062, "starting within a step of where it was sung")
        }
    }

    func testAJumpInPitchStartsANewNote() {
        // A glide straight from one note into the next, no gap: still two notes.
        let legato = segment(
            frames(voice([Sung(at: 0.2, dur: 0.4, midi: 60), Sung(at: 0.6, dur: 0.4, midi: 67)], seconds: 1.2)),
            gate: 0.01)
        XCTAssertEqual(legato.map { Int($0.pitch.rounded()) }, [60, 67])
    }

    func testNoiseGate() {
        XCTAssertEqual(noiseGate([]), 0.01)
        let quiet = [0.001, 0.002, 0.003].map { HumFrame(time: 0, level: $0, midi: nil) }
        XCTAssertEqual(noiseGate(quiet), 0.006, accuracy: 1e-12)
        XCTAssertEqual(noiseGate([HumFrame(time: 0, level: 0.5, midi: nil)]), 0.05)
        XCTAssertEqual(noiseGate([HumFrame(time: 0, level: 0.0001, midi: nil)]), 0.004)
    }

    // MARK: the loop

    // The same tune hummed slightly flat and early, as people do.
    let sloppy = [
        RawNote(start: 0.480, end: 0.700, pitch: 61.7),
        RawNote(start: 0.745, end: 0.960, pitch: 64.2),
        RawNote(start: 1.010, end: 1.220, pitch: 64.6),
        RawNote(start: 1.240, end: 1.720, pitch: 68.8),
    ]

    func testLandsOnTheGridInKeyHeldToTheNextNote() {
        let lead = fitHum(sloppy, options: FitOptions(start: 0.5, step: 0.125, bars: .one, part: .lead))
        XCTAssertEqual(lead.pattern.notes, [
            PatternNote(step: 0, note: 62, length: 2),
            PatternNote(step: 2, note: 64, length: 2),
            PatternNote(step: 4, note: 65, length: 2),
            PatternNote(step: 6, note: 69, length: 4),
        ])
        XCTAssertEqual(lead.pattern.bars, .one)
    }

    func testABassLineHummedHighMovesDownIntoTheBassRange() {
        let bass = fitHum(sloppy, options: FitOptions(start: 0.5, step: 0.125, bars: .one, part: .bass))
        XCTAssertEqual(bass.pattern.notes.map { $0.note }, [38, 40, 41, 45])
    }

    func testALeadHummedLowMovesUpAnOctave() {
        let low = fitHum(
            [RawNote(start: 0, end: 0.5, pitch: 48), RawNote(start: 0.5, end: 1.0, pitch: 52)],
            options: FitOptions(start: 0, step: 0.125, bars: .one, part: .lead))
        XCTAssertEqual(low.pattern.notes.map { $0.note }, [60, 64])
    }

    func testADrumHumStaysWhereItWasHummed() {
        let drums = fitHum(
            [RawNote(start: 0, end: 0.5, pitch: 48), RawNote(start: 0.5, end: 1.0, pitch: 52)],
            options: FitOptions(start: 0, step: 0.125, bars: .one, part: .drums))
        XCTAssertEqual(drums.pattern.notes.map { $0.note }, [48, 52])
    }

    func testADropoutMidNoteDoesNotSplitItButASungRepeatDoes() {
        // A held E that dropped out for 25 ms mid-note (as a busy Mac's audio can),
        // next to two E's sung "da da" on the beat.
        let dropped = fitHum(
            [
                RawNote(start: 0.500, end: 0.690, pitch: 64),
                RawNote(start: 0.715, end: 0.870, pitch: 64.1),
                RawNote(start: 1.000, end: 1.110, pitch: 64),
                RawNote(start: 1.125, end: 1.240, pitch: 64),
            ],
            options: FitOptions(start: 0.5, step: 0.125, bars: .one, part: .lead))
        XCTAssertEqual(dropped.pattern.notes, [
            PatternNote(step: 0, note: 64, length: 3),
            PatternNote(step: 4, note: 64, length: 1),
            PatternNote(step: 5, note: 64, length: 1),
        ])
    }

    func testNotesPastTheLoopAreDropped() {
        let late = fitHum(
            [RawNote(start: 0, end: 0.4, pitch: 60), RawNote(start: 2.1, end: 2.5, pitch: 62)],
            options: FitOptions(start: 0, step: 0.125, bars: .one, part: .lead))
        XCTAssertEqual(late.pattern.notes.count, 1)
    }

    func testAnInBetweenNoteRoundsToTheNearestUnlessTheLoopsKeySaysOtherwise() {
        // D E F G, with the F hummed between F and F#: it rounds to F unless the
        // loop says the song is in D major, where F# belongs.
        let between = [62.0, 64, 65.45, 67].enumerated().map { i, pitch in
            RawNote(start: Double(i) * 0.25, end: Double(i) * 0.25 + 0.24, pitch: pitch)
        }
        let opts = FitOptions(start: 0, step: 0.125, bars: .one, part: .lead)
        XCTAssertEqual(fitHum(between, options: opts).pattern.notes.map { $0.note }, [62, 64, 65, 67])
        var inD = opts
        inD.context = [50, 54, 57, 50, 54, 57, 62, 66]
        XCTAssertEqual(fitHum(between, options: inD).pattern.notes.map { $0.note }, [62, 64, 66, 67])
        XCTAssertEqual(keyName(fitHum(between, options: inD).key), "D major")
    }

    func testACMajorTuneIsInCMajor() {
        let key = guessKey([60, 62, 64, 65, 67, 60].map { WeightedNote(note: $0, weight: 2) })
        XCTAssertEqual(keyName(key), "C major")
        XCTAssertEqual(key, Key(root: 0, minor: false))
    }

    func testKeyNames() {
        XCTAssertEqual(keyName(Key(root: 9, minor: true)), "A minor")
        XCTAssertEqual(keyName(Key(root: 3, minor: false)), "Eb major")
    }

    func testDescribeTake() {
        let take = fitHum(sloppy, options: FitOptions(start: 0.5, step: 0.125, bars: .one, part: .lead))
        XCTAssertEqual(describeTake(take), "D4 E4 F4 A4")
    }

    func testPartRangeHasNoDrums() {
        XCTAssertEqual(partRange[.bass], 28...55)
        XCTAssertNil(partRange[.drums])
    }
}
