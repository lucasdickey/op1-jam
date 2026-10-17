// The MIDISink for the chosen output: one CoreMIDI output port, pointed at
// whichever destination is selected. The player calls send from its own
// thread with a JamClock time, and CoreMIDI holds the bytes until then.

import CoreMIDI
import Foundation
import Op1Core

final class CoreMIDIOutput: MIDISink {
    private let clock: HostClock
    private let lock = NSLock()
    private var port: MIDIPortRef = 0
    private var destination: MIDIEndpointRef = 0

    init(clock: HostClock) {
        self.clock = clock
    }

    /// Where sends go from now on. A destination of 0 is nowhere: sends are dropped.
    func retarget(port: MIDIPortRef, destination: MIDIEndpointRef) {
        lock.lock()
        self.port = port
        self.destination = destination
        lock.unlock()
    }

    func send(_ bytes: [UInt8], at time: TimeInterval) {
        lock.lock()
        let port = self.port
        let destination = self.destination
        lock.unlock()
        guard port != 0, destination != 0, !bytes.isEmpty else { return }

        // One packet holding all the bytes. The list struct has room for a
        // 256-byte packet; anything longer (sysex) needs the extra bytes.
        let size = MemoryLayout<MIDIPacketList>.size + bytes.count
        let buffer = UnsafeMutableRawPointer.allocate(
            byteCount: size, alignment: MemoryLayout<MIDIPacketList>.alignment)
        defer { buffer.deallocate() }
        let list = buffer.bindMemory(to: MIDIPacketList.self, capacity: 1)
        let packet = MIDIPacketListInit(list)
        let stamp = clock.timeStamp(from: time)
        bytes.withUnsafeBufferPointer { buf in
            guard let base = buf.baseAddress else { return }
            // The list was sized for this one packet, so the add cannot run out
            // of room; its return value (the next packet slot) is not needed.
            _ = MIDIPacketListAdd(list, ByteCount(size), packet, stamp, ByteCount(buf.count), base)
            _ = MIDISend(port, destination, list)
        }
    }
}
