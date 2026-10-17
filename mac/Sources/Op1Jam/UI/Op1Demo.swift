// The OP-1 on a getting-started card. A card plays a short script on it —
// which keys to hold and press, what the screen shows — one beat at a time,
// each beat a button to jump to. The Op1Demo from op1-device.tsx, with the
// flat drawing only.

import SwiftUI

struct Op1Demo: View {
    let beats: [Beat]
    /// Whether the card is showing; the beats only step while it is.
    let active: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var at = 0
    @State private var paused = false

    private var beat: Beat { beats[min(at, beats.count - 1)] }
    private var stepping: Bool { active && !reduceMotion && !paused && beats.count > 1 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Op1Drawing(hold: beat.hold, press: beat.press, screen: beat.screen)
                .frame(maxWidth: 420)
            FlowLayout(spacing: 6) {
                ForEach(Array(beats.enumerated()), id: \.offset) { i, b in
                    Button {
                        at = i
                        paused = true
                    } label: {
                        HStack(spacing: 6) {
                            Text("\(i + 1)")
                                .fontWeight(.bold)
                                .foregroundStyle(Palette.orange)
                            Text(LocalizedStringKey(b.say))
                        }
                        .font(.system(size: 12, design: .monospaced))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Palette.key)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(i == at ? Palette.ink : Palette.rule, lineWidth: i == at ? 1.5 : 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            if !reduceMotion {
                LinkButton(title: paused ? "▶ Play the steps" : "❚❚ Pause") { paused.toggle() }
            }
        }
        .task(id: "\(at)-\(stepping)") {
            guard stepping else { return }
            try? await Task.sleep(nanoseconds: UInt64(beat.seconds * 1_000_000_000))
            if !Task.isCancelled && stepping {
                at = (at + 1) % beats.count
            }
        }
    }
}

/// Lays its children out in rows, wrapping like words, so the beat buttons
/// fit whatever width the card has.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var maxX: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            maxX = max(maxX, x - spacing)
        }
        return CGSize(width: width == .infinity ? maxX : width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
