// The parts the person has recorded to the OP-1's tape, so Claude writes
// around them.

import Op1Core
import SwiftUI

struct TapePanel: View {
    @ObservedObject var model: JamModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PanelTitle(text: "On tape")
            Text("Recorded this part to tape? Press the button so Claude fits the next parts around it.")
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(Palette.dim)
            KeyButton(title: "I recorded this to tape", tone: Palette.green) { model.recordToTape() }
                .disabled(model.shown == nil || (model.shown?.notes.isEmpty ?? true) || model.tape.count >= maxTape)
            if !model.tape.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(model.tape.enumerated()), id: \.offset) { index, layer in
                        HStack(spacing: 8) {
                            Circle().fill(Palette.part(layer.part)).frame(width: 8, height: 8)
                            Text("\(partLabel(layer.part)) · \(barsLabel(layer.pattern.bars)) · \(layer.pattern.notes.count) notes")
                                .font(.system(size: 13, design: .monospaced))
                            LinkButton(title: "Remove") { model.removeTape(at: index) }
                        }
                    }
                }
            }
        }
        .panel()
    }
}
