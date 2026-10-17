// One line under the screen: the error, what the hum is doing, what Claude
// is doing, or Claude's note about the loop.

import Op1Core
import SwiftUI

struct StatusLine: View {
    @ObservedObject var model: JamModel

    var body: some View {
        // Always two lines tall, so a long message (the hum prompt, an error)
        // doesn't push everything below it down and back up again: a hidden
        // two-line placeholder sits under whatever the line says.
        ZStack(alignment: .topLeading) {
            Text(" \n ").hidden()
            message
        }
        .font(.system(size: 13, design: .monospaced))
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private var message: some View {
        Group {
            if let error = model.error {
                Text(error).foregroundStyle(Palette.warn)
            } else if let humming = model.humming {
                Text(humText(humming)).foregroundStyle(Palette.dim)
            } else if model.asking {
                Text("Claude is writing the next loop…").foregroundStyle(Palette.dim)
            } else if model.waiting {
                Text("Next loop is ready. It starts at the top of the loop.")
            } else if let line = model.line {
                HStack(spacing: 0) {
                    Text("“\(line)”")
                    if let took = model.took {
                        Text(" · \(String(format: "%.1f", Double(took) / 1000)) s")
                            .foregroundStyle(Palette.dim)
                    }
                }
            } else {
                Text(" ")
            }
        }
        .lineLimit(2)
    }

    private func humText(_ state: HumState) -> String {
        switch state {
        case .opening: return "Opening the mic…"
        case .count(let beat): return "Count-in… \(beat)"
        case .hum(let bar): return "Hum now: bar \(bar) of \(model.bars.rawValue). Sing “da da da” for clear notes."
        case .done: return "Got it."
        }
    }
}
