// The Mac's microphone, read for pitch. The audio stays in the app: it is
// turned into readings (when, how loud, what pitch) as it arrives, and only
// the notes made from them ever leave, in the request to Claude. A port of
// src/renderer/jam/mic.ts and capture.worklet.js in the Electron app, over
// AVAudioEngine instead of the Web Audio API.
//
// Every reading is stamped on the JamClock, the one the player stamps its
// MIDI with, so a hummed note can be placed against the beat. The stamp is
// the moment the sound reached the mic: the time CoreAudio gives the buffer,
// less the time the sound took to get through the Mac's input to here.

import AVFoundation
import Foundation
import Op1Core

/// Readings are taken on the mic's sound at half its rate: plenty for a voice.
private let decimate = 2
/// How much sound each reading looks at, and how often one is taken, in samples at the reduced rate.
private let window = 1024
private let hop = 256
/// How sure a reading has to be to count as a pitch.
private let minClarity = 0.6
/// The input's delay when the system doesn't report one: typical of a Mac's built-in mic.
private let defaultInputSeconds: TimeInterval = 0.012
/// How much sound the engine is asked to hand over at a time. macOS rounds
/// this up to its own minimum (about 100 ms), which only delays the readings
/// a little; it doesn't move their stamps.
private let tapFrames: AVAudioFrameCount = 1024

/// Host ticks are not nanoseconds on every Mac (Apple silicon counts at
/// 24 MHz), so the ratio is read from the kernel once. The same conversion
/// as the MIDI side's HostClock, so the stamps land on the same clock.
private let secondsPerHostTick: Double = {
    var info = mach_timebase_info_data_t()
    _ = mach_timebase_info(&info)
    return Double(info.numer) / Double(info.denom) / 1_000_000_000
}()

public final class MicCapture: MicCapturing {
    /// Guards everything below: the tap runs on the engine's own thread
    /// while `stop` is called from the main one.
    private let lock = NSLock()
    private var engine: AVAudioEngine?
    private var onFrame: ((HumFrame) -> Void)?
    private var running = false

    /// The input's rate, and how long sound takes to get through it to us.
    private var sampleRate: Double = 48_000
    private var inputSeconds: TimeInterval = defaultInputSeconds

    /// The last few windows of sound at the reduced rate.
    private var ring = [Float](repeating: 0, count: window * 4)
    /// Samples (reduced rate) received so far, and the next reading's first one.
    private var count = 0
    private var next = 0
    /// The JamClock moment of the latest buffer's first sample, and the
    /// reduced-rate count when that buffer began, so any sample can be timed.
    private var bufferTime: TimeInterval = 0
    private var bufferFirst = 0

    public init() {}

    /// Ask for the mic and start reading it. Throws MicError with a line for the person.
    public func start(onFrame: @escaping @Sendable (HumFrame) -> Void) async throws {
        stop()
        let allowed = await AVCaptureDevice.requestAccess(for: .audio)
        if !allowed {
            throw MicError("The mic is blocked. Allow OP-1 Jam in System Settings → Privacy & Security → Microphone.")
        }
        if AVCaptureDevice.default(for: .audio) == nil {
            throw MicError("No microphone found.")
        }

        let engine = AVAudioEngine()
        let input = engine.inputNode
        // Raw sound: the Mac's voice processing would smooth away the starts
        // of notes, and with headphones there is no echo to cancel.
        do {
            try input.setVoiceProcessingEnabled(false)
        } catch {
            throw MicError("Couldn't open the microphone.")
        }
        let format = input.outputFormat(forBus: 0)
        if format.sampleRate <= 0 || format.channelCount == 0 {
            throw MicError("Couldn't open the microphone.")
        }

        let reported = input.presentationLatency
        lock.withLock {
            self.engine = engine
            self.onFrame = onFrame
            running = true
            sampleRate = format.sampleRate
            inputSeconds = reported > 0 ? reported : defaultInputSeconds
            ring = [Float](repeating: 0, count: window * 4)
            count = 0
            next = 0
            bufferTime = 0
            bufferFirst = 0
        }

        // The tap has to take the input's own format; only its first channel
        // is read, which makes it mono.
        input.installTap(onBus: 0, bufferSize: tapFrames, format: nil) { [weak self] buffer, when in
            self?.take(buffer, at: when)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            lock.withLock {
                self.engine = nil
                self.onFrame = nil
                running = false
            }
            throw MicError("Couldn't start listening to the microphone.")
        }
    }

    /// Stop listening and let go of the mic, so macOS's mic light goes out.
    public func stop() {
        lock.lock()
        let engine = self.engine
        self.engine = nil
        onFrame = nil
        running = false
        lock.unlock()
        guard let engine = engine else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }

    /// The numbers the timing correction uses, for Debug Mode.
    public var timing: (sampleRate: Double, inputSeconds: TimeInterval) {
        lock.lock()
        defer { lock.unlock() }
        return (sampleRate, inputSeconds)
    }

    /// The JamClock moment the first sample of a buffer reached the mic.
    private func when(_ time: AVAudioTime, frames: Int) -> TimeInterval {
        if time.isHostTimeValid {
            return Double(time.hostTime) * secondsPerHostTick - inputSeconds
        }
        // No stamp (it shouldn't happen on a live input): the buffer just
        // ended, so it began its own length ago.
        return Double(mach_absolute_time()) * secondsPerHostTick - Double(frames) / sampleRate - inputSeconds
    }

    private func take(_ buffer: AVAudioPCMBuffer, at time: AVAudioTime) {
        lock.lock()
        defer { lock.unlock() }
        guard running, let onFrame = onFrame, let channels = buffer.floatChannelData else { return }
        let samples = channels[0]
        let n = Int(buffer.frameLength)
        bufferTime = when(time, frames: n)
        bufferFirst = count

        let rate = sampleRate / Double(decimate)
        var buf = [Float](repeating: 0, count: window)
        // Halve the rate by averaging pairs, which also cuts the hiss above a
        // voice. Readings are taken as soon as a window fills, so no buffer,
        // however long, can overrun the ring before it is read.
        let reduced = n / decimate
        for i in 0..<reduced {
            let v = (samples[i * decimate] + samples[i * decimate + 1]) / 2
            ring[count % ring.count] = v
            count += 1
            while next + window <= count {
                for j in 0..<window { buf[j] = ring[(next + j) % ring.count] }
                let p = detectPitch(buf, sampleRate: rate)
                // The reading is of the window's middle, timed from this
                // buffer's first sample at the input's rate.
                let centre = next + window / 2
                let offset = Double((centre - bufferFirst) * decimate) / sampleRate
                var midi: Double? = nil
                if let p = p, p.clarity >= minClarity { midi = hzToMidi(p.hz) }
                onFrame(HumFrame(time: bufferTime + offset, level: level(buf), midi: midi))
                next += hop
            }
        }
    }
}
