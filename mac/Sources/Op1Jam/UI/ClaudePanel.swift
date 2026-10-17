// What Claude writes: the part, the loop length, the direction, Write the
// next loop, and how often to keep changing.

import Op1Core
import SwiftUI

struct ClaudePanel: View {
    @ObservedObject var model: JamModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PanelTitle(text: "Claude")

            VStack(alignment: .leading, spacing: 6) {
                FieldLabel(text: "Part")
                SegmentRow(items: Part.allCases, selection: $model.part, label: partLabel, dot: Palette.part)
            }

            VStack(alignment: .leading, spacing: 6) {
                FieldLabel(text: "Loop")
                SegmentRow(items: LoopBars.allCases, selection: $model.bars, label: barsLabel)
            }

            VStack(alignment: .leading, spacing: 6) {
                FieldLabel(text: "Direction")
                TextField(
                    "e.g. D minor, slow and sparse, leave room for my lead",
                    text: Binding(
                        get: { model.direction },
                        set: { model.direction = String($0.prefix(500)) }),
                    axis: .vertical)
                    .lineLimit(2...4)
                    .textFieldStyle(.roundedBorder)
            }

            HStack(spacing: 14) {
                KeyButton(title: "Write the next loop", tone: Palette.orange) { model.askNow() }
                    .disabled(!model.connected || model.humming != nil)
                HStack(spacing: 6) {
                    FieldLabel(text: "Keep changing")
                    Picker("Keep changing", selection: $model.every) {
                        ForEach(everyChoices, id: \.self) { n in
                            Text(everyLabel(n)).tag(n)
                        }
                    }
                    .labelsHidden()
                    .frame(width: 150)
                }
            }

            // The notices keep their place when they don't apply, so the
            // panel (and the tape below it) doesn't jump when one comes up.
            notice("Keep changing is paused after an error. Write the next loop to resume.",
                   shown: model.autoPaused && model.every > 0)
            notice("Claude writes a new \(partLabel(model.part).lowercased()) part next time it’s asked.",
                   shown: model.part != model.shownPart && model.shown != nil)
        }
        .panel()
    }

    private func notice(_ text: String, shown: Bool) -> some View {
        Text(text)
            .font(.system(size: 12, design: .monospaced))
            .foregroundStyle(Palette.dim)
            .fixedSize(horizontal: false, vertical: true)
            .opacity(shown ? 1 : 0)
            .accessibilityHidden(!shown)
    }

    private func everyLabel(_ n: Int) -> String {
        n == 0 ? "never" : n == 1 ? "every loop" : "every \(n) loops"
    }
}
