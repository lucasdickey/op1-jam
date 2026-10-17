// The MIDI ports: where notes go, where the OP-1's keys come from, which
// channel, a Test sound key, and the out/in lights. The app connects by
// itself, so there is no Connect button as on the page.

import Op1Core
import SwiftUI

struct MIDIPanel: View {
    @ObservedObject var model: JamModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 16) {
                portPicker("Send to", ports: model.outputs, selection: Binding(
                    get: { model.selectedOutput },
                    set: { model.selectOutput($0) }))
                portPicker("Listen to", ports: model.inputs, selection: Binding(
                    get: { model.selectedInput },
                    set: { model.selectInput($0) }))
                HStack(spacing: 6) {
                    FieldLabel(text: "Channel")
                    Picker("Channel", selection: $model.channel) {
                        ForEach(1...16, id: \.self) { ch in
                            Text("\(ch)").tag(ch)
                        }
                    }
                    .labelsHidden()
                    .frame(width: 70)
                }
                KeyButton(title: "Test sound", tone: Palette.white) { model.testSound() }
                    .disabled(!model.connected)
                Lights(model: model)
                Spacer()
            }
            if model.outputs.isEmpty {
                Text("No OP-1 found. Is it on, in OP-1 mode, and plugged in with a data cable?")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Palette.warn)
            }
        }
        .panel()
    }

    private func portPicker(_ label: String, ports: [MIDIPortInfo], selection: Binding<String?>) -> some View {
        HStack(spacing: 6) {
            FieldLabel(text: label)
            Picker(label, selection: selection) {
                Text("—").tag(String?.none)
                ForEach(ports) { port in
                    Text(port.name).tag(Optional(port.id))
                }
            }
            .labelsHidden()
            .frame(minWidth: 140, maxWidth: 220)
        }
    }
}

/// "out" lights while the app has a note sounding, "in" briefly after a note
/// arrives from the OP-1. Redrawn a few times a second rather than by state.
struct Lights: View {
    @ObservedObject var model: JamModel

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !model.connected)) { _ in
            HStack(spacing: 10) {
                light("out", on: model.connected && model.outLit(), color: Palette.orange)
                light("in", on: model.connected && model.inLit(), color: Palette.green)
            }
        }
    }

    private func light(_ name: String, on: Bool, color: Color) -> some View {
        HStack(spacing: 4) {
            Circle()
                .fill(on ? color : Palette.rule)
                .frame(width: 8, height: 8)
                .shadow(color: on ? color.opacity(0.7) : .clear, radius: 3)
            Text(name)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(Palette.dim)
        }
    }
}
