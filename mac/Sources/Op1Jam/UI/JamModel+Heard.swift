// What the person plays on the OP-1: each note placed on the loop's grid as
// it arrives, and gathered for Claude when the next loop is asked for. The
// MIDI-in part of src/renderer/jam/jam.tsx.

import Foundation
import Op1Core

extension JamModel {

    /// A message from the selected input, handed over on the main actor.
    func received(_ message: MIDIMessage) {
        let data = message.bytes
        guard data.count >= 3 else { return }
        let type = data[0] & 0xf0
        let note = Int(data[1])
        let velocity = data[2]
        let now = clock.now()
        // The stamp shares the JamClock; distrust one that's far off.
        let t = abs(message.time - now) < 5 ? message.time : now

        if type == 0x90 && velocity > 0 {
            if player.isEcho(note, t) { return }
            lastIn = now
            let mark = player.playing ? player.locate(t) : nil
            played.append(Played(note: note, on: t, off: nil, mark: mark))
            if played.count > maxPlayed { played.removeFirst(played.count - maxPlayed) }
            heard = Array((heard + [note]).suffix(16))
            if part == .drums && !drumKeys.contains(note) && drumKeys.count < maxDrumKeys {
                drumKeys = (drumKeys + [note]).sorted()
            }
        } else if type == 0x80 || (type == 0x90 && velocity == 0) {
            for i in played.indices.reversed() where played[i].note == note && played[i].off == nil {
                played[i].off = t
                break
            }
        }
    }

    /// Stopping forgets where the notes fell; the pitches still count.
    func forgetTiming() {
        for i in played.indices { played[i].mark = nil }
    }

    /// What the person played, for the request: notes from the last two
    /// loops placed on the grid, and notes played with the loop stopped as
    /// bare pitches.
    func collectHeard() -> [HeardNote] {
        let now = clock.now()
        let loopNow = player.loopNow
        let seconds = player.stepSeconds()
        let running = player.playing
        var timed: [HeardNote] = []
        var loose: [HeardNote] = []
        for p in played {
            if let mark = p.mark, running {
                let ago = loopNow - mark.loop
                if ago < 0 || ago > 2 { continue }
                let length = p.off.map { min(64, max(1, Int((($0 - p.on) / seconds).rounded()))) }
                timed.append(HeardNote(note: p.note, step: mark.step, loopsAgo: ago, length: length))
            } else if p.mark == nil && now - p.on < looseSeconds {
                loose.append(HeardNote(note: p.note, step: nil, loopsAgo: nil, length: nil))
            }
        }
        return Array(loose.suffix(24)) + Array(timed.suffix(96))
    }
}
