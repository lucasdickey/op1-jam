// What the app's parts promise each other, so each can be built and tested
// on its own: the MIDI side, the Claude call, the key store and the mic
// each implement one of these, and the jam model only ever sees the protocol.

import Foundation
import Op1Core

/// A MIDI port the person can pick from a menu.
public struct MIDIPortInfo: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    /// Whether the name says it is an OP-1, so it can be chosen by default.
    public let isOP1: Bool

    public init(id: String, name: String, isOP1: Bool) {
        self.id = id
        self.name = name
        self.isOP1 = isOP1
    }
}

/// A MIDI message that arrived from the selected input.
public struct MIDIMessage: Equatable, Sendable {
    public let bytes: [UInt8]
    /// Seconds on the JamClock, when it arrived.
    public let time: TimeInterval

    public init(bytes: [UInt8], time: TimeInterval) {
        self.bytes = bytes
        self.time = time
    }
}

/// The Mac's MIDI ports: which exist, which are chosen, and the sink for the
/// chosen output. Published so SwiftUI menus follow hot-plugging.
@MainActor
public protocol MIDIDevices: ObservableObject {
    var inputs: [MIDIPortInfo] { get }
    var outputs: [MIDIPortInfo] { get }
    var selectedOutput: String? { get }
    var selectedInput: String? { get }
    /// The sink for the selected output, or nil when there is none.
    var output: MIDISink? { get }
    /// Called with every message from the selected input, on any thread.
    var onMessage: ((MIDIMessage) -> Void)? { get set }
    func selectOutput(_ id: String?)
    func selectInput(_ id: String?)
}

/// Asks Claude for the next loop. Cancel by cancelling the Task.
public protocol PatternWriting: Sendable {
    func writePattern(_ request: PatternRequest) async throws -> PatternResponse
}

/// The AI Gateway key, kept in the Keychain.
public protocol KeyStoring: Sendable {
    func load() -> String?
    func save(_ key: String) throws
    func clear() throws
}

/// The Mac's microphone, read for pitch. Each reading is stamped on the
/// JamClock at the moment the sound reached the mic, less the input's delay.
public protocol MicCapturing: AnyObject {
    /// Ask for the mic and start reading it. Throws MicError with a line for the person.
    func start(onFrame: @escaping @Sendable (HumFrame) -> Void) async throws
    func stop()
}

/// A mic problem, worded for the person.
public struct MicError: LocalizedError, Equatable {
    public let line: String
    public init(_ line: String) { self.line = line }
    public var errorDescription: String? { line }
}
