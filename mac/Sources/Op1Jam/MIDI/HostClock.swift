// The one clock everything on the Mac is timed on: mach host time, the same
// counter CoreMIDI stamps packets with and CoreAudio stamps buffers with, so a
// note time, a packet time and a mic reading can be compared directly. The
// core only ever sees seconds; this file is where ticks become seconds.

import CoreMIDI
import Foundation
import Op1Core

/// Host ticks are not nanoseconds on every Mac (Apple silicon counts at
/// 24 MHz), so the ratio is read from the kernel once.
private let secondsPerHostTick: Double = {
    var info = mach_timebase_info_data_t()
    _ = mach_timebase_info(&info)
    return Double(info.numer) / Double(info.denom) / 1_000_000_000
}()

/// The JamClock for the Mac: mach_absolute_time in seconds. Monotonic, counts
/// from boot, and the same clock as CoreMIDI's MIDITimeStamp, so the two
/// convert with a multiply and no offset.
public struct HostClock: JamClock {
    public init() {}

    public func now() -> TimeInterval {
        seconds(from: mach_absolute_time())
    }

    /// A CoreMIDI timestamp (host ticks) as JamClock seconds.
    public func seconds(from stamp: MIDITimeStamp) -> TimeInterval {
        Double(stamp) * secondsPerHostTick
    }

    /// JamClock seconds as a CoreMIDI timestamp. Zero or earlier means "now"
    /// to both, so it stays zero.
    public func timeStamp(from seconds: TimeInterval) -> MIDITimeStamp {
        guard seconds > 0 else { return 0 }
        return MIDITimeStamp((seconds / secondsPerHostTick).rounded())
    }
}
