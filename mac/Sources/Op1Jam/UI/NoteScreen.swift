// The screen: the loop drawn on the sixteenth-note grid, one lane per key,
// in the part's colour, with the playhead moving over it. The Screen
// component in jam.tsx, drawn on a Canvas rather than as boxes. Black in
// both appearances, like the device's own screen.

import Op1Core
import SwiftUI

struct NoteScreen: View {
    @ObservedObject var model: JamModel

    private let nameWidth: CGFloat = 48
    private let laneGap: CGFloat = 2
    private let minLane: CGFloat = 14
    private let maxLane: CGFloat = 26

    var body: some View {
        let pattern = model.shown
        let keys = lanes(pattern)
        TimelineView(.animation(paused: !model.playing)) { _ in
            Canvas { context, size in
                draw(in: &context, size: size, pattern: pattern, keys: keys,
                     playhead: model.playing ? model.playheadStep() : -1)
            }
        }
        .frame(height: max(150, CGFloat(keys.count) * 18 + 26))
        .overlay {
            if keys.isEmpty {
                Text(pattern == nil ? model.screenNote : "This loop is silent.")
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Palette.screenDim)
                    .multilineTextAlignment(.center)
                    .padding()
            }
        }
        .background(Palette.screen)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.black, lineWidth: 1))
    }

    /// The keys in the loop, highest first.
    private func lanes(_ pattern: Pattern?) -> [Int] {
        guard let pattern = pattern else { return [] }
        return Array(Set(pattern.notes.map { $0.note })).sorted(by: >)
    }

    private func draw(in context: inout GraphicsContext, size: CGSize, pattern: Pattern?, keys: [Int], playhead: Int) {
        guard let pattern = pattern, !keys.isEmpty else { return }
        let steps = pattern.bars.steps
        let inset: CGFloat = 14
        let left = inset + nameWidth
        let right = size.width - inset
        let width = max(1, right - left)
        let stepWidth = width / CGFloat(steps)
        let count = CGFloat(keys.count)
        let lane = min(maxLane, max(minLane, (size.height - 2 * inset - laneGap * (count - 1)) / count))
        let top = inset
        let color = Palette.part(model.shownPart)

        for (i, key) in keys.enumerated() {
            let y = top + CGFloat(i) * (lane + laneGap)
            let track = CGRect(x: left, y: y, width: width, height: lane)
            let name = model.shownPart == .drums ? String(key) : noteName(key)
            context.draw(
                Text(name).font(.system(size: 10, design: .monospaced)).foregroundStyle(Palette.screenDim),
                at: CGPoint(x: inset, y: track.midY), anchor: .leading)

            // Beat lines, and brighter bar lines.
            for step in stride(from: 0, to: steps, by: 4) {
                let x = left + CGFloat(step) * stepWidth
                let bar = step % stepsPerBar == 0
                var path = Path()
                path.move(to: CGPoint(x: x, y: track.minY))
                path.addLine(to: CGPoint(x: x, y: track.maxY))
                context.stroke(path, with: .color(bar ? Palette.screenBar : Palette.screenBeat), lineWidth: 1)
            }

            for note in pattern.notes where note.note == key {
                let x = left + CGFloat(note.step) * stepWidth
                let w = max(3, CGFloat(note.length) * stepWidth - 2)
                let hit = CGRect(x: x, y: track.minY + 2, width: w, height: lane - 4)
                context.fill(Path(roundedRect: hit, cornerRadius: 2), with: .color(color))
            }
        }

        if playhead >= 0 && playhead < steps {
            let x = left + CGFloat(playhead) * stepWidth
            let bottom = top + count * lane + (count - 1) * laneGap
            let column = CGRect(x: x, y: top - 2, width: stepWidth, height: bottom - top + 4)
            context.fill(Path(column), with: .color(Color.white.opacity(0.09)))
            var edge = Path()
            edge.move(to: CGPoint(x: x + 1, y: column.minY))
            edge.addLine(to: CGPoint(x: x + 1, y: column.maxY))
            context.stroke(edge, with: .color(Palette.orange), lineWidth: 2)
        }
    }
}
