// The heading over the jam, as page.tsx has it, with a way back to the steps.

import SwiftUI

struct HeaderView: View {
    let onSteps: () -> Void

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
                Text("[ OP-1 JAM ]")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Palette.dim)
                Text("Claude plays, you pick the sound")
                    .font(.system(size: 26, weight: .bold, design: .monospaced))
                Text("Claude writes the notes. Your OP-1 plays them on whatever sound you pick.")
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Palette.dim)
            }
            Spacer()
            LinkButton(title: "Getting started", action: onSteps)
        }
    }
}
