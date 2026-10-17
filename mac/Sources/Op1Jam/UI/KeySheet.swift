// Asks for the AI Gateway key on first launch, and again from the app
// menu's "Claude Key…". The key goes to the Keychain through the model;
// this sheet never keeps it. A port of src/renderer/key-setup.tsx.

import SwiftUI

struct KeySheet: View {
    @ObservedObject var model: JamModel
    @State private var value = ""
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Connect to Claude")
                .font(.system(size: 20, weight: .bold, design: .monospaced))
            Text("OP-1 Jam asks Claude for each loop through the Vercel AI Gateway. Paste a gateway key once; it’s kept in your Mac’s Keychain.")
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(Palette.dim)
            Link("Where to get a key", destination: URL(string: "https://vercel.com/docs/ai-gateway")!)
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(Palette.blue)

            VStack(alignment: .leading, spacing: 6) {
                FieldLabel(text: "AI Gateway key")
                SecureField(
                    model.hasKey ? "A key is saved. Paste a new one to replace it." : "",
                    text: $value)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { save() }
            }

            if let error = error {
                Text(error)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Palette.warn)
            }

            HStack(spacing: 12) {
                KeyButton(title: "Save key", tone: Palette.orange, prominent: true) { save() }
                    .disabled(value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button(model.hasKey ? "Cancel" : "Not now") { model.showingKey = false }
                    .keyboardShortcut(.cancelAction)
                if model.hasKey {
                    LinkButton(title: "Remove the saved key") { remove() }
                }
                Spacer()
            }
        }
        .padding(24)
        .frame(width: 520)
        .fontDesign(.monospaced)
    }

    private func save() {
        do {
            try model.saveKey(value)
            value = ""
            error = nil
        } catch {
            self.error = errorText(error, fallback: "The key couldn't be saved.")
        }
    }

    private func remove() {
        do {
            try model.clearKey()
            error = nil
        } catch {
            self.error = errorText(error, fallback: "The key couldn't be removed.")
        }
    }
}
