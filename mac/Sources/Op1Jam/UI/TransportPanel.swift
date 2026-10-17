// Play/Stop, Hum, the tempo and Send clock, as the page's transport row.

import Op1Core
import SwiftUI

struct TransportPanel: View {
    @ObservedObject var model: JamModel
    @State private var tempoText = ""

    var body: some View {
        HStack(spacing: 14) {
            KeyButton(
                title: model.playing ? "■ Stop" : "▶ Play",
                tone: Palette.orange,
                prominent: model.playing
            ) { model.togglePlaying() }
                .disabled(!model.connected)

            KeyButton(title: humTitle, tone: Palette.blue, prominent: model.humming != nil, widest: "Count 4") { model.hum() }
                .disabled(!model.connected || (model.part == .drums && model.humming == nil))
                .help(model.part == .drums ? "Hum a bass, chords, lead or arpeggio part" : "")

            HStack(spacing: 8) {
                FieldLabel(text: "Tempo")
                Slider(
                    value: Binding(
                        get: { Double(min(180, max(60, model.tempo))) },
                        set: { model.changeTempo(Int($0.rounded())) }),
                    in: 60...180, step: 1)
                    .frame(width: 160)
                TextField("", text: $tempoText)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 56)
                    .multilineTextAlignment(.trailing)
                    .onSubmit { commitTempo() }
                FieldLabel(text: "BPM")
            }

            Toggle("Send clock", isOn: $model.clockOn)
                .toggleStyle(.checkbox)
            Spacer()
        }
        .panel()
        .onAppear { tempoText = String(model.tempo) }
        .onChange(of: model.tempo) { _, tempo in tempoText = String(tempo) }
    }

    private var humTitle: String {
        switch model.humming {
        case nil: return "Hum"
        case .opening?: return "Mic…"
        case .count(let n)?: return "Count \(n)"
        default: return "Cancel"
        }
    }

    private func commitTempo() {
        if let value = Int(tempoText.trimmingCharacters(in: .whitespaces)) {
            model.changeTempo(value)
        }
        tempoText = String(model.tempo)
    }
}
