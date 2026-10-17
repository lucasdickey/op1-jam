// A hummed take, from the Hum button: a bar of clicks on the OP-1 to count
// in, the loop's length of humming, then the tune on the loop's grid. The
// recording itself is `recordHum` in the Audio side of the app; this is the
// hum part of src/renderer/jam/jam.tsx around it.

import Foundation
import Op1Core

extension JamModel {

    /// Start a take, or cancel the one in progress.
    public func hum() {
        if let task = humTask {
            task.cancel()
            return
        }
        guard connected, part != .drums else { return }
        cancelAsk()
        humming = .opening
        error = nil
        waiting = false

        // The key comes from what's already in play, except drums, whose
        // notes are samples rather than pitches.
        var context: [Int] = []
        if let current = player.current, currentPart != .drums {
            context += current.notes.map { $0.note }
        }
        for layer in tape where layer.part != .drums {
            context += layer.pattern.notes.map { $0.note }
        }
        let humPart = part
        let options = HumOptions(
            bars: bars,
            part: humPart,
            context: context,
            onProgress: { [weak self] progress in
                self?.humProgressed(progress, part: humPart)
            })

        let player = self.player
        let mic = self.mic
        let clock = self.clock
        humTask = Task { [weak self] in
            do {
                let take = try await recordHum(player: player, mic: mic, clock: clock, options: options)
                self?.hummed(take, part: humPart)
            } catch is CancellationError {
                self?.humFailed(nil)
            } catch {
                self?.humFailed(error)
            }
            self?.humFinished()
        }
    }

    private func humProgressed(_ progress: HumProgress, part humPart: Part) {
        // Stopped, the take starts the player for its clicks.
        if player.playing && !playing { playing = true }
        switch progress.phase {
        case .count:
            humming = .count(progress.beat)
            humClock = nil
        case .hum:
            humming = .hum(bar: progress.beat)
            humClock = (start: progress.start, step: progress.stepSeconds)
        case .done:
            humming = .done
            humClock = nil
        }
        if let take = progress.take {
            shown = take.pattern
            shownPart = humPart
        }
    }

    private func hummed(_ take: HumTake, part humPart: Part) {
        // The take is loaded and waits for the next step; its part goes with it.
        waitingPart = humPart
        // Claude's next loop for this part is a variation on the hum.
        written = (part: humPart, direction: direction)
        // Keep the hum looping until the person asks Claude for more.
        every = 0
        line = "Your hum in \(keyName(take.key)): \(describeTake(take)). Hum again to redo it, or put it on tape and have Claude write under it."
        took = nil
    }

    /// `nil` when the take was cancelled.
    private func humFailed(_ failure: Error?) {
        if let failure = failure {
            error = errorText(failure, fallback: "Humming failed.")
        }
        // The take cancelled whatever was waiting once the mic opened.
        if player.waiting == nil { waitingPart = nil }
        shown = player.waiting ?? player.current
        if shown != nil { shownPart = player.waiting != nil ? (waitingPart ?? currentPart) : currentPart }
    }

    private func humFinished() {
        humTask = nil
        humClock = nil
        humming = nil
        if !player.playing { playing = false }
    }
}
