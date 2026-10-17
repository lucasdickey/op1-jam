// The app: one window with the jam in it, and the app menu's "Claude Key…".
// The real Mac pieces are built here and handed to the model by their
// protocols; nothing else in the interface knows about CoreMIDI, the
// Keychain, the gateway or the mic. What src/main/index.ts and
// src/renderer/main.tsx do in the Electron app.
//
// Not ported: Debug Mode (the panel and the ⌥⌘D toggle).

import SwiftUI

@main
struct Op1JamApp: App {
    @StateObject private var model: JamModel

    init() {
        let clock = HostClock()
        _model = StateObject(wrappedValue: JamModel(
            devices: CoreMIDIDevices(),
            clock: clock,
            keys: KeychainKeyStore(),
            mic: MicCapture(),
            makeWriter: { key in GatewayPatternWriter(key: key) }))
    }

    var body: some Scene {
        WindowGroup("OP-1 Jam") {
            JamWindow(model: model)
        }
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("Claude Key…") { model.showingKey = true }
                    .keyboardShortcut(",", modifiers: .command)
            }
            CommandGroup(replacing: .help) {
                Button("Getting Started") { model.showingSteps = true }
            }
        }
    }
}
