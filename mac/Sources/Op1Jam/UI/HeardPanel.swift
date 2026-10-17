// What the person played on the OP-1, and the drum keys it has learned.

import Op1Core
import SwiftUI

struct HeardPanel: View {
    @ObservedObject var model: JamModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PanelTitle(text: "From the OP-1")
            if model.heard.isEmpty {
                Text("Play the OP-1’s keys. Your notes show here, and Claude answers them.")
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Palette.dim)
            } else {
                Text(model.heard.map { noteName($0) }.joined(separator: " "))
                    .font(.system(size: 14, design: .monospaced))
            }
            if model.part == .drums || !model.drumKeys.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        FieldLabel(text: "Drum keys")
                        if model.drumKeys.isEmpty {
                            Text("none yet. With Drums selected, tap each drum key you want Claude to use.")
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(Palette.dim)
                        } else {
                            Text(model.drumKeys.map { String($0) }.joined(separator: " "))
                                .font(.system(size: 13, design: .monospaced))
                        }
                    }
                    if !model.drumKeys.isEmpty {
                        LinkButton(title: "Forget these") { model.forgetDrumKeys() }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .panel()
    }
}
