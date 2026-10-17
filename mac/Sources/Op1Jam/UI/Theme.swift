// The jam's palette, as op1.css has it: a brushed-aluminium grey body, a
// black screen where the loop is drawn, and the four encoder colours (blue,
// green, white, orange) as the only accents. Each part gets one of them on
// the screen, so a glance says which part is playing. The greys follow the
// Mac's light and dark appearance; the screen is black in both, like the
// device's.

import AppKit
import Op1Core
import SwiftUI

/// A colour with a light and a dark version, resolved by the window's appearance.
private func dynamic(light: Int, dark: Int) -> Color {
    Color(nsColor: NSColor(name: nil) { appearance in
        let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        return NSColor(hex: isDark ? dark : light)
    })
}

extension NSColor {
    convenience init(hex: Int) {
        self.init(
            red: CGFloat((hex >> 16) & 0xff) / 255,
            green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255,
            alpha: 1)
    }
}

extension Color {
    init(hex: Int) {
        self.init(nsColor: NSColor(hex: hex))
    }
}

enum Palette {
    static let ground = dynamic(light: 0xe3e4e6, dark: 0x121316)
    static let panel = dynamic(light: 0xf1f1f2, dark: 0x1a1c20)
    static let ink = dynamic(light: 0x1c1e21, dark: 0xe4e6ea)
    static let dim = dynamic(light: 0x686c74, dark: 0x8e939c)
    static let rule = dynamic(light: 0xc7c9ce, dark: 0x2c2f35)
    static let key = dynamic(light: 0xfbfbfb, dark: 0x262a30)
    static let warn = dynamic(light: 0xb3361a, dark: 0xff8a6b)

    static let blue = Color(hex: 0x2f6fea)
    static let green = Color(hex: 0x12a364)
    static let white = Color(hex: 0xeceae4)
    static let orange = Color(hex: 0xff5a1f)
    static let red = Color(hex: 0xff3d4d)

    static let screen = Color(hex: 0x0a0b0d)
    static let screenInk = Color(hex: 0xc9ced6)
    static let screenDim = Color(hex: 0x5f6570)
    static let screenBeat = Color(hex: 0x16191e)
    static let screenBar = Color(hex: 0x2a2e36)

    /// The encoder colour each part is drawn in.
    static func part(_ part: Part) -> Color {
        switch part {
        case .bass: return blue
        case .chords: return green
        case .lead: return white
        case .arpeggio: return orange
        case .drums: return red
        }
    }
}

/// "Bass", "Chords"…, as the page labels the parts.
func partLabel(_ part: Part) -> String {
    switch part {
    case .bass: return "Bass"
    case .chords: return "Chords"
    case .lead: return "Lead"
    case .arpeggio: return "Arpeggio"
    case .drums: return "Drums"
    }
}

/// "1 bar", "2 bars".
func barsLabel(_ bars: LoopBars) -> String {
    bars == .one ? "1 bar" : "\(bars.rawValue) bars"
}

/// A rounded panel on the window's ground, like the page's op-panel.
struct PanelStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.panel)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Palette.rule, lineWidth: 1))
    }
}

extension View {
    func panel() -> some View { modifier(PanelStyle()) }
}

/// A small heading in capitals, like the page's op-h2.
struct PanelTitle: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .bold, design: .monospaced))
            .kerning(1)
            .foregroundStyle(Palette.dim)
    }
}

/// A short label over a control, like the page's op-label.
struct FieldLabel: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 12, design: .monospaced))
            .foregroundStyle(Palette.dim)
    }
}

/// One of the OP-1's keys as a button: a raised key with a coloured dot,
/// like the page's op-key. `tone` is the dot's colour; nil for no dot.
struct KeyButton: View {
    let title: String
    var tone: Color? = nil
    /// Filled with its colour, as the page's Play key while playing.
    var prominent = false
    /// The longest title this button ever shows. Its width is kept, so the
    /// button doesn't change size (and move what's beside it) as it relabels.
    var widest: String? = nil
    let action: () -> Void

    var body: some View {
        if prominent {
            button.buttonStyle(.borderedProminent).controlSize(.large).tint(tone)
        } else {
            button.buttonStyle(.bordered).controlSize(.large)
        }
    }

    private var button: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if let tone = tone {
                    Circle().fill(prominent ? Color.white : tone).frame(width: 8, height: 8)
                }
                ZStack {
                    if let widest = widest {
                        Text(widest).fontWeight(.semibold).hidden()
                    }
                    Text(title).fontWeight(.semibold)
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
        }
    }
}

/// A row of pills where one is chosen, like the page's op-segments.
struct SegmentRow<Item: Hashable>: View {
    let items: [Item]
    @Binding var selection: Item
    let label: (Item) -> String
    var dot: ((Item) -> Color)? = nil

    var body: some View {
        HStack(spacing: 6) {
            ForEach(items, id: \.self) { item in
                let on = item == selection
                Button {
                    selection = item
                } label: {
                    HStack(spacing: 7) {
                        if let dot = dot {
                            Circle().fill(dot(item)).frame(width: 8, height: 8)
                                .overlay(Circle().stroke(Color.black.opacity(0.15), lineWidth: 1))
                        }
                        Text(label(item))
                    }
                    .font(.system(size: 13, design: .monospaced))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(on ? Palette.ink : Palette.key)
                    .foregroundStyle(on ? Palette.panel : Palette.ink)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(on ? Palette.ink : Palette.rule, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// A text-only button in the page's blue, like op-link.
struct LinkButton: View {
    let title: String
    let action: () -> Void
    var body: some View {
        Button(title, action: action)
            .buttonStyle(.plain)
            .foregroundStyle(Palette.blue)
            .font(.system(size: 13, design: .monospaced))
            .underline()
    }
}
