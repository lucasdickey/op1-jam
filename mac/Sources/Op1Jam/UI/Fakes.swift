// Stand-ins for the Mac side, so a preview can show the window without an
// OP-1, a Keychain or a mic, and so the model can be exercised without them.
// Debug builds only.

#if DEBUG
import Combine
import Foundation
import Op1Core
import SwiftUI

/// Wall-clock seconds; good enough for a preview.
struct FakeClock: JamClock {
    func now() -> TimeInterval { Date().timeIntervalSince1970 }
}

/// A port list with one OP-1 in it, chosen from the start. Bytes go nowhere.
@MainActor
final class FakeDevices: MIDIDevices {
    @Published private(set) var inputs: [MIDIPortInfo] = [MIDIPortInfo(id: "in", name: "OP-1 Midi Device", isOP1: true)]
    @Published private(set) var outputs: [MIDIPortInfo] = [MIDIPortInfo(id: "out", name: "OP-1 Midi Device", isOP1: true)]
    @Published private(set) var selectedOutput: String? = "out"
    @Published private(set) var selectedInput: String? = "in"
    var onMessage: ((MIDIMessage) -> Void)?

    private final class Sink: MIDISink {
        func send(_ bytes: [UInt8], at time: TimeInterval) {}
    }
    private let sink = Sink()

    var output: MIDISink? { selectedOutput == nil ? nil : sink }

    func selectOutput(_ id: String?) { selectedOutput = outputs.contains { $0.id == id } ? id : nil }
    func selectInput(_ id: String?) { selectedInput = inputs.contains { $0.id == id } ? id : nil }
}

/// Answers every ask with the same short bass line after a moment.
struct FakeWriter: PatternWriting {
    func writePattern(_ request: PatternRequest) async throws -> PatternResponse {
        try await Task.sleep(nanoseconds: 800_000_000)
        let notes = [
            PatternNote(step: 0, note: 38, length: 4),
            PatternNote(step: 6, note: 41, length: 2),
            PatternNote(step: 8, note: 45, length: 4),
            PatternNote(step: 14, note: 43, length: 2),
        ]
        return PatternResponse(
            pattern: Pattern(bars: request.bars, notes: notes),
            note: "A walking bass in D minor, leaving the top open.",
            ms: 800)
    }
}

/// Remembers the key for the run only.
final class FakeKeyStore: KeyStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var key: String?

    init(key: String? = "preview") { self.key = key }

    func load() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return key
    }

    func save(_ key: String) throws {
        lock.lock()
        defer { lock.unlock() }
        self.key = key
    }

    func clear() throws {
        lock.lock()
        defer { lock.unlock() }
        key = nil
    }
}

/// A mic that hears nothing.
final class FakeMic: MicCapturing {
    func start(onFrame: @escaping @Sendable (HumFrame) -> Void) async throws {}
    func stop() {}
}

extension JamModel {
    /// A model on fakes, for previews. Callable from anywhere; previews
    /// are built on the main thread.
    nonisolated static func preview() -> JamModel {
        MainActor.assumeIsolated {
            JamModel(
                devices: FakeDevices(),
                clock: FakeClock(),
                keys: FakeKeyStore(),
                mic: FakeMic(),
                makeWriter: { _ in FakeWriter() })
        }
    }
}

struct JamWindow_Previews: PreviewProvider {
    static var previews: some View {
        JamWindow(model: JamModel.preview())
    }
}

struct StepsSheet_Previews: PreviewProvider {
    static var previews: some View {
        StepsSheet(connected: true, outputName: "OP-1 Midi Device", onTest: {}, onDone: {})
    }
}
#endif
