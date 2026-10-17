// The window's page: Claude plays an OP-1 over USB MIDI. The same layout as
// page.tsx and jam.tsx in the Electron app, top to bottom: the heading, the
// MIDI ports, the transport, the screen, the status line, the Claude and
// From-the-OP-1 panels side by side, the tape. The key sheet and the
// getting-started steps come up over it.

import Op1Core
import SwiftUI

struct JamWindow: View {
    @ObservedObject var model: JamModel
    /// Once the steps have been closed they stay away until asked for.
    @AppStorage("op1:steps-hidden") private var stepsHidden = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HeaderView(onSteps: { model.showingSteps = true })
                MIDIPanel(model: model)
                TransportPanel(model: model)
                NoteScreen(model: model)
                StatusLine(model: model)
                HStack(alignment: .top, spacing: 14) {
                    ClaudePanel(model: model)
                    HeardPanel(model: model)
                }
                TapePanel(model: model)
            }
            .padding(24)
            .frame(maxWidth: 1040, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Palette.ground)
        .foregroundStyle(Palette.ink)
        .fontDesign(.monospaced)
        .frame(minWidth: 760, minHeight: 640)
        .sheet(isPresented: $model.showingKey) {
            KeySheet(model: model)
        }
        .sheet(isPresented: $model.showingSteps) {
            StepsSheet(
                connected: model.connected,
                outputName: model.outputName,
                onTest: { model.testSound() },
                onDone: {
                    stepsHidden = true
                    model.showingSteps = false
                })
        }
        .onAppear {
            // First launch: the key first, then the steps once it's dealt with.
            if !model.showingKey && !stepsHidden { model.showingSteps = true }
        }
        .onChange(of: model.showingKey) { _, showing in
            if !showing && !stepsHidden { model.showingSteps = true }
        }
    }
}
