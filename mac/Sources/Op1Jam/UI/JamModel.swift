// The jam's state. Everything that has to be on time lives in Op1Core's
// Player; this object only shows what the player is doing, gathers what the
// person played, and asks Claude for the next loop. A port of the state and
// callbacks in src/renderer/jam/jam.tsx in the Electron app, with the
// window's chrome (the key sheet, the steps) kept here too so the app menu
// can open them.
//
// It talks to the Mac only through the protocols in AppContracts.swift, so
// a preview or a test can hand it fakes (see Fakes.swift).

import Combine
import Foundation
import Op1Core

/// Loops each pattern plays before Claude is asked for the next; 0 is never.
let everyChoices = [0, 1, 2, 4, 8]

/// How long a note played with the loop stopped still counts, in seconds.
let looseSeconds: TimeInterval = 60
let maxPlayed = 256
let maxDrumKeys = 24

/// Where a hummed take is, for the Hum button and the status line.
public enum HumState: Equatable {
    /// Asking for the mic.
    case opening
    /// Count-in beats left: 4, 3, 2, 1.
    case count(Int)
    /// The bar being hummed, 1-based.
    case hum(bar: Int)
    case done
}

/// A note the person played on the OP-1, and where in the loop it fell.
struct Played {
    var note: Int
    var on: TimeInterval
    var off: TimeInterval?
    var mark: StepMark?
}

/// Lets the player's loop callback reach the model without the model
/// capturing itself before it is built.
private final class ModelRelay {
    weak var model: JamModel?
}

@MainActor
public final class JamModel: ObservableObject {

    // MARK: - What Claude writes

    @Published public var part: Part = .bass
    /// Beats per minute, 40–240. Set through `changeTempo` so the player follows.
    @Published public internal(set) var tempo = 110
    @Published public var bars: LoopBars = .two {
        didSet { player.setIdleBars(bars) }
    }
    @Published public var direction = ""
    /// Loops between asks; 0 is never. Changing it resumes after an error.
    @Published public var every = 2 {
        didSet { autoPaused = false }
    }

    // MARK: - Transport

    @Published public internal(set) var playing = false
    /// Send MIDI clock, start and stop, so the OP-1 can follow the app's tempo.
    @Published public var clockOn = false {
        didSet { player.setClock(clockOn) }
    }
    /// MIDI channel, 1–16 as the OP-1 shows it.
    @Published public var channel = 1 {
        didSet { player.setChannel(channel) }
    }

    // MARK: - The screen and the status line

    /// The pattern on the screen, and which part it was written for.
    @Published public internal(set) var shown: Pattern?
    @Published public internal(set) var shownPart: Part = .bass
    /// Claude's next loop is loaded and waits for the top of the loop.
    @Published public internal(set) var waiting = false
    @Published public internal(set) var asking = false
    /// Claude's one line about what it wrote, or the hum's.
    @Published public internal(set) var line: String?
    /// How long Claude took, in milliseconds, for the status line.
    @Published public internal(set) var took: Int?
    @Published public internal(set) var error: String?
    /// Keep changing is paused after an error, until the next ask.
    @Published public internal(set) var autoPaused = false
    @Published public internal(set) var humming: HumState?

    // MARK: - From the OP-1

    /// The last sixteen notes played, newest last.
    @Published public internal(set) var heard: [Int] = []
    /// Note numbers the drum kit's keys send, learned from what was played.
    @Published public internal(set) var drumKeys: [Int] = []
    @Published public internal(set) var tape: [TapeLayer] = []

    // MARK: - MIDI

    @Published public internal(set) var inputs: [MIDIPortInfo] = []
    @Published public internal(set) var outputs: [MIDIPortInfo] = []
    @Published public internal(set) var selectedInput: String?
    @Published public internal(set) var selectedOutput: String?

    /// Whether there is an output to play to.
    public var connected: Bool { selectedOutput != nil }
    public var outputName: String? {
        outputs.first { $0.id == selectedOutput }?.name
    }

    // MARK: - Claude's key and the window's sheets

    @Published public internal(set) var hasKey = false
    /// The "Connect to Claude" sheet; up on first launch and from the app menu.
    @Published public var showingKey = false
    /// The getting-started steps.
    @Published public var showingSteps = false

    // MARK: - Dependencies

    public let player: Player
    let clock: JamClock
    let devices: any MIDIDevices
    let keys: KeyStoring
    let mic: MicCapturing
    private let makeWriter: (String) -> PatternWriting
    private var writer: PatternWriting?
    private var devicesChanges: AnyCancellable?

    // MARK: - What the callbacks keep between turns

    var played: [Played] = []
    private var askTask: Task<Void, Never>?
    /// Counts asks, so an answer to an earlier ask is dropped.
    private var askGeneration = 0
    var humTask: Task<Void, Never>?
    /// Where the take's step 0 falls, for the playhead while humming.
    var humClock: (start: TimeInterval, step: TimeInterval)?
    /// Loops the playing pattern has run, counting the one sounding now.
    private var since = 0
    /// The part and direction the newest pattern was written for.
    var written: (part: Part, direction: String)?
    /// The parts the player's current and waiting patterns were written for.
    var currentPart: Part = .bass
    var waitingPart: Part?
    /// When the last note arrived from the OP-1, for the "in" light.
    var lastIn: TimeInterval = -.infinity

    /// `makeWriter` builds the Claude side from a gateway key; it is called
    /// again whenever the key changes.
    public init<Devices: MIDIDevices>(
        devices: Devices,
        clock: JamClock,
        keys: KeyStoring,
        mic: MicCapturing,
        makeWriter: @escaping (String) -> PatternWriting
    ) {
        self.devices = devices
        self.clock = clock
        self.keys = keys
        self.mic = mic
        self.makeWriter = makeWriter

        let relay = ModelRelay()
        player = Player(
            clock: clock,
            events: PlayerEvents(onLoop: { loop, pattern, swapped in
                relay.model?.onLoop(loop: loop, pattern: pattern, swapped: swapped)
            }))
        relay.model = self

        player.setTempo(Double(tempo))
        player.setChannel(channel)
        player.setClock(clockOn)
        player.setIdleBars(bars)

        if let key = keys.load() {
            writer = makeWriter(key)
            hasKey = true
        } else {
            showingKey = true
        }

        // The ports' lists and choices live in the MIDI side; mirror them
        // here after each change, so the views only watch one object.
        devicesChanges = devices.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.syncDevices() }
        devices.onMessage = { [weak self] message in
            Task { @MainActor in self?.received(message) }
        }
        syncDevices()
    }

    // MARK: - Ports

    public func selectOutput(_ id: String?) {
        devices.selectOutput(id)
        syncDevices()
    }

    public func selectInput(_ id: String?) {
        devices.selectInput(id)
        syncDevices()
    }

    /// Copy the MIDI side's lists and choices, and follow the output: the
    /// player plays to whatever is chosen, and stops when it goes away.
    func syncDevices() {
        let outs = devices.outputs
        let ins = devices.inputs
        if outputs != outs { outputs = outs }
        if inputs != ins { inputs = ins }
        if selectedInput != devices.selectedInput { selectedInput = devices.selectedInput }

        let next = devices.selectedOutput
        if next != selectedOutput {
            if let old = selectedOutput, !outs.contains(where: { $0.id == old }) {
                error = "The MIDI output went away. Is the OP-1 still plugged in and out of disk mode?"
            }
            selectedOutput = next
            if next == nil && player.playing { stop() }
            player.setOutput(devices.output)
        }
    }

    // MARK: - Transport

    public func play() {
        guard connected else { return }
        forgetTiming()
        since = 0
        player.start()
        guard player.playing else { return }
        playing = true
        if player.current == nil && !asking {
            autoPaused = false
            ask()
        }
    }

    public func stop() {
        humTask?.cancel()
        player.stop()
        forgetTiming()
        playing = false
        waiting = false
        // A pattern that arrived too late to play became the current one.
        if let p = waitingPart {
            currentPart = p
            waitingPart = nil
        }
        shown = player.current
        if shown != nil { shownPart = currentPart }
    }

    public func togglePlaying() {
        if playing { stop() } else { play() }
    }

    public func changeTempo(_ value: Int) {
        let bpm = min(240, max(40, value))
        tempo = bpm
        player.setTempo(Double(bpm))
    }

    /// Three rising notes, to check the OP-1 is listening.
    public func testSound() {
        player.testNotes()
    }

    /// The top of a loop, from the player on the main queue. `swapped` says a
    /// waiting pattern started here.
    func onLoop(loop: Int, pattern: Pattern?, swapped: Bool) {
        // The player hands loop tops to the main queue, so one scheduled just
        // before Stop can arrive after it; a stopped player has nothing to announce.
        guard player.playing else { return }
        // A take picked up mid-loop is announced at the next top without the
        // flag; the waiting part having gone through says it swapped too.
        let swappedNow = swapped || (waitingPart != nil && player.waiting == nil)
        if swappedNow {
            if let p = waitingPart { currentPart = p }
            waitingPart = nil
            shown = pattern ?? player.current
            if shown != nil { shownPart = currentPart }
            waiting = false
            since = 0
        }
        since += 1
        if every > 0 && since >= every && !autoPaused && !asking && humTask == nil && player.waiting == nil {
            ask()
        }
    }

    // MARK: - Asking Claude

    /// Ask now, resuming Keep changing if an error paused it.
    public func askNow() {
        autoPaused = false
        ask()
    }

    func ask() {
        guard let writer = writer else {
            error = "No Claude key yet. Choose Claude Key… in the OP-1 Jam menu."
            // Don't keep asking every loop into the same failure.
            autoPaused = true
            showingKey = true
            return
        }
        askTask?.cancel()
        askGeneration += 1
        let generation = askGeneration
        asking = true
        error = nil

        let askedPart = part
        let askedDirection = direction
        let request = PatternRequest(
            part: askedPart,
            tempo: Double(tempo),
            bars: bars,
            direction: String(askedDirection.prefix(500)),
            newDirection: written.map { $0.direction != askedDirection }
                ?? !askedDirection.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            // A pattern written for another part is no use as a starting point.
            current: written?.part == askedPart ? (player.waiting ?? player.current) : nil,
            heard: collectHeard(),
            drumKeys: askedPart == .drums ? drumKeys : [],
            tape: tape)

        askTask = Task { [weak self] in
            do {
                let data = try await writer.writePattern(request)
                guard let self = self, self.askGeneration == generation else { return }
                self.answered(data, part: askedPart, direction: askedDirection)
            } catch {
                guard let self = self, self.askGeneration == generation, !Task.isCancelled else { return }
                self.error = errorLine(error)
                // Don't keep asking every loop into the same failure.
                self.autoPaused = true
            }
            if let self = self, self.askGeneration == generation {
                self.askTask = nil
                self.asking = false
            }
        }
    }

    private func answered(_ data: PatternResponse, part: Part, direction: String) {
        written = (part: part, direction: direction)
        player.load(data.pattern)
        if player.playing {
            waitingPart = part
            waiting = true
        } else {
            currentPart = part
            waitingPart = nil
            shown = data.pattern
            shownPart = part
            waiting = false
        }
        line = data.note
        took = data.ms
    }

    /// Stop waiting on Claude: a take is about to replace whatever it writes.
    func cancelAsk() {
        askTask?.cancel()
        askTask = nil
        askGeneration += 1
        asking = false
    }

    // MARK: - Tape and drum keys

    /// Keep the pattern on the screen in mind as a part on the OP-1's tape.
    public func recordToTape() {
        guard let shown = shown, tape.count < maxTape else { return }
        tape.append(TapeLayer(part: shownPart, pattern: shown))
    }

    public func removeTape(at index: Int) {
        guard tape.indices.contains(index) else { return }
        tape.remove(at: index)
    }

    public func forgetDrumKeys() {
        drumKeys = []
    }

    // MARK: - The key

    /// Save a gateway key and start asking Claude through it.
    public func saveKey(_ key: String) throws {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 500 else { throw BadKeyError() }
        try keys.save(trimmed)
        writer = makeWriter(trimmed)
        hasKey = true
        showingKey = false
    }

    public func clearKey() throws {
        try keys.clear()
        writer = nil
        hasKey = false
    }

    // MARK: - For the views, each frame

    /// The step under the playhead now, or -1 for none.
    public func playheadStep() -> Int {
        let now = clock.now()
        if let hum = humClock {
            return now >= hum.start ? Int(((now - hum.start) / hum.step).rounded(.down)) : -1
        }
        return player.positionAt(now)?.step ?? -1
    }

    /// Whether the app has a note sounding now, for the "out" light.
    public func outLit() -> Bool {
        player.soundingAt(clock.now())
    }

    /// Whether a note arrived from the OP-1 just now, for the "in" light.
    public func inLit() -> Bool {
        clock.now() - lastIn < 0.15
    }

    /// What the empty screen says.
    public var screenNote: String {
        if !connected { return "Connect the OP-1 to begin." }
        if asking && shown == nil { return "Claude is writing the first loop…" }
        return "No loop yet. Press Play and Claude writes one."
    }
}

/// A pasted key that cannot be one: empty, or far longer than any key is.
struct BadKeyError: LocalizedError {
    var errorDescription: String? { "That doesn't look like a key." }
}

/// An error as one line for the status line.
func errorText(_ error: Error, fallback: String) -> String {
    if error is CancellationError { return "Cancelled." }
    let raw = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    let first = raw.split(separator: "\n", omittingEmptySubsequences: true).first.map(String.init) ?? ""
    let line = String(first.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
    return line.isEmpty ? fallback : line
}
