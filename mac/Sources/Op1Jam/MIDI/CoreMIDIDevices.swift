// The Mac's MIDI ports, through CoreMIDI. One client, one input port and one
// output port for the life of the app: the selected source is connected to
// the input port, and the selected destination is where the output sink
// sends. CoreMIDI tells the client when ports come and go, and the lists
// refresh so the menus follow hot-plugging and the OP-1 is picked as soon as
// it appears. The CoreMIDI side of jam.tsx in the Electron app.
//
// This uses the MIDIPacketList API (plain MIDI 1.0 bytes). macOS 14 marks it
// deprecated in favour of MIDIEventList but still supports it; the OP-1
// speaks MIDI 1.0 and bytes are what the rest of the app understands.

import Combine
import CoreMIDI
import Foundation
import Op1Core

@MainActor
public final class CoreMIDIDevices: MIDIDevices {
    @Published public private(set) var inputs: [MIDIPortInfo] = []
    @Published public private(set) var outputs: [MIDIPortInfo] = []
    @Published public private(set) var selectedOutput: String?
    @Published public private(set) var selectedInput: String?
    /// A line for the person when CoreMIDI could not be started; the lists
    /// then stay empty.
    @Published public private(set) var error: String?

    public var onMessage: ((MIDIMessage) -> Void)? {
        didSet { inbox.setHandler(onMessage) }
    }

    /// The sink for the selected output, or nil when there is none.
    public var output: MIDISink? {
        selectedOutput == nil ? nil : sink
    }

    /// The clock the messages and the sink are timed on.
    public let clock: HostClock

    private let inbox: MIDIInbox
    private let sink: CoreMIDIOutput
    private let handle = MIDIClientHandle()
    private var inputPort: MIDIPortRef = 0
    private var outputPort: MIDIPortRef = 0
    /// The source wired to the input port right now, 0 for none.
    private var connectedSource: MIDIEndpointRef = 0
    private var sources: [String: MIDIEndpointRef] = [:]
    private var destinations: [String: MIDIEndpointRef] = [:]

    public init(clock: HostClock = HostClock()) {
        self.clock = clock
        inbox = MIDIInbox(clock: clock)
        sink = CoreMIDIOutput(clock: clock)
        start()
    }

    public func selectOutput(_ id: String?) {
        let endpoint = id.flatMap { destinations[$0] } ?? 0
        sink.retarget(port: outputPort, destination: endpoint)
        let next = endpoint == 0 ? nil : id
        if selectedOutput != next { selectedOutput = next }
    }

    public func selectInput(_ id: String?) {
        let endpoint = id.flatMap { sources[$0] } ?? 0
        if connectedSource != 0 && connectedSource != endpoint {
            _ = MIDIPortDisconnectSource(inputPort, connectedSource)
            connectedSource = 0
        }
        if endpoint != 0 && connectedSource == 0 && inputPort != 0 {
            if MIDIPortConnectSource(inputPort, endpoint, nil) == 0 {
                connectedSource = endpoint
            }
        }
        let next = connectedSource == 0 ? nil : id
        if selectedInput != next { selectedInput = next }
    }

    /// Makes the client and its two ports, then reads the ports that exist.
    /// The notify block runs on CoreMIDI's thread, so it only hops to the
    /// main actor and refreshes there.
    private func start() {
        var client: MIDIClientRef = 0
        let created = MIDIClientCreateWithBlock("OP-1 Jam" as CFString, &client) { [weak self] notification in
            switch notification.pointee.messageID {
            case .msgSetupChanged, .msgObjectAdded, .msgObjectRemoved:
                Task { @MainActor in
                    guard let self = self else { return }
                    self.refresh()
                }
            default:
                break
            }
        }
        guard created == 0 else {
            error = "CoreMIDI could not be started."
            return
        }
        handle.client = client

        var inPort: MIDIPortRef = 0
        var outPort: MIDIPortRef = 0
        guard MIDIInputPortCreateWithBlock(client, "Input" as CFString, &inPort, inbox.readBlock) == 0,
              MIDIOutputPortCreate(client, "Output" as CFString, &outPort) == 0
        else {
            error = "CoreMIDI could not open its ports."
            return
        }
        inputPort = inPort
        outputPort = outPort
        refresh()
    }

    /// Reads the sources and destinations again and settles the selections.
    private func refresh() {
        var ins: [MIDIPortInfo] = []
        var outs: [MIDIPortInfo] = []
        var sourcesById: [String: MIDIEndpointRef] = [:]
        var destinationsById: [String: MIDIEndpointRef] = [:]
        for index in 0..<MIDIGetNumberOfSources() {
            let endpoint = MIDIGetSource(index)
            guard let info = portInfo(endpoint), sourcesById[info.id] == nil else { continue }
            ins.append(info)
            sourcesById[info.id] = endpoint
        }
        for index in 0..<MIDIGetNumberOfDestinations() {
            let endpoint = MIDIGetDestination(index)
            guard let info = portInfo(endpoint), destinationsById[info.id] == nil else { continue }
            outs.append(info)
            destinationsById[info.id] = endpoint
        }
        sources = sourcesById
        destinations = destinationsById
        if inputs != ins { inputs = ins }
        if outputs != outs { outputs = outs }
        selectInput(pickPort(ins, current: selectedInput))
        selectOutput(pickPort(outs, current: selectedOutput))
    }
}

/// The port to select after the list changes: keep the current one, else find
/// the OP-1, else the first port when nothing was chosen yet, so an OP-1 wired
/// through another interface still plays at launch.
private func pickPort(_ ports: [MIDIPortInfo], current: String?) -> String? {
    if let current = current, ports.contains(where: { $0.id == current }) { return current }
    if let op1 = ports.first(where: { $0.isOP1 }) { return op1.id }
    return current == nil ? ports.first?.id : nil
}

/// The OP-1 presents itself as "OP-1 Midi Device"; some drivers drop the dash.
private func looksLikeOp1(_ name: String) -> Bool {
    name.range(of: "op-?1", options: [.regularExpression, .caseInsensitive]) != nil
}

/// A port's menu entry, or nil for one that is offline or has no id. The id
/// is CoreMIDI's unique id, which survives unplugging and replugging.
private func portInfo(_ endpoint: MIDIEndpointRef) -> MIDIPortInfo? {
    guard endpoint != 0, let uniqueID = integerProperty(endpoint, kMIDIPropertyUniqueID) else { return nil }
    if (integerProperty(endpoint, kMIDIPropertyOffline) ?? 0) != 0 { return nil }
    let name = stringProperty(endpoint, kMIDIPropertyDisplayName)
        ?? stringProperty(endpoint, kMIDIPropertyName)
        ?? "Unnamed port"
    return MIDIPortInfo(id: String(uniqueID), name: name, isOP1: looksLikeOp1(name))
}

private func stringProperty(_ object: MIDIObjectRef, _ property: CFString) -> String? {
    var value: Unmanaged<CFString>?
    guard MIDIObjectGetStringProperty(object, property, &value) == 0, let value = value else { return nil }
    return value.takeRetainedValue() as String
}

private func integerProperty(_ object: MIDIObjectRef, _ property: CFString) -> Int32? {
    var value: Int32 = 0
    guard MIDIObjectGetIntegerProperty(object, property, &value) == 0 else { return nil }
    return value
}

/// Owns the client ref so it is disposed, ports and all, when the devices
/// object goes away. Kept apart from the main-actor class so disposing it
/// needs no actor hop.
private final class MIDIClientHandle {
    var client: MIDIClientRef = 0

    deinit {
        if client != 0 { _ = MIDIClientDispose(client) }
    }
}

/// The input side, which CoreMIDI calls on its own high-priority thread. It
/// holds nothing from the main actor: just the clock to stamp with and the
/// handler, swapped under a lock.
private final class MIDIInbox {
    private let clock: HostClock
    private let lock = NSLock()
    private var handler: ((MIDIMessage) -> Void)?

    init(clock: HostClock) {
        self.clock = clock
    }

    func setHandler(_ handler: ((MIDIMessage) -> Void)?) {
        lock.lock()
        self.handler = handler
        lock.unlock()
    }

    /// The block for the input port. Walks the packets in place: a packet's
    /// bytes follow its header and may run past the 256 the struct declares,
    /// so they are read through the raw pointer, not copied out of the struct.
    var readBlock: MIDIReadBlock {
        return { [self] list, _ in
            let count = Int(list.pointee.numPackets)
            guard count > 0 else { return }
            // Both structs are packed to 4 bytes, so the packets start after the
            // 4-byte count and a packet's bytes after its 8-byte stamp and 2-byte
            // length; the layout is asked anyway in case that ever changes.
            let packetOffset = MemoryLayout<MIDIPacketList>.offset(of: \MIDIPacketList.packet) ?? 4
            let dataOffset = MemoryLayout<MIDIPacket>.offset(of: \MIDIPacket.data) ?? 10
            var packet = (UnsafeRawPointer(list) + packetOffset).assumingMemoryBound(to: MIDIPacket.self)
            for _ in 0..<count {
                let length = Int(packet.pointee.length)
                let data = UnsafeRawBufferPointer(start: UnsafeRawPointer(packet) + dataOffset, count: length)
                self.deliver(Array(data), stamp: packet.pointee.timeStamp)
                packet = UnsafePointer(MIDIPacketNext(packet))
            }
        }
    }

    private func deliver(_ bytes: [UInt8], stamp: MIDITimeStamp) {
        lock.lock()
        let handler = self.handler
        lock.unlock()
        guard let handler = handler, !bytes.isEmpty else { return }
        // A stamp of 0 is CoreMIDI's "now"; the OP-1's driver stamps its packets.
        let time = stamp == 0 ? clock.now() : clock.seconds(from: stamp)
        for message in splitMessages(bytes) {
            handler(MIDIMessage(bytes: message, time: time))
        }
    }
}

/// One packet can carry several messages back to back. The handler expects
/// one at a time, so split on status bytes. Real-time bytes (clock, start,
/// stop) are one byte each and may land in the middle of another message;
/// they are lifted out on their own. Sysex runs from F0 to F7.
private func splitMessages(_ bytes: [UInt8]) -> [[UInt8]] {
    var messages: [[UInt8]] = []
    var current: [UInt8] = []
    for byte in bytes {
        if byte >= 0xF8 {
            messages.append([byte])
        } else if byte == 0xF7 {
            current.append(byte)
            messages.append(current)
            current = []
        } else if byte >= 0x80 {
            if !current.isEmpty { messages.append(current) }
            current = [byte]
        } else {
            current.append(byte)
        }
    }
    if !current.isEmpty { messages.append(current) }
    return messages
}
