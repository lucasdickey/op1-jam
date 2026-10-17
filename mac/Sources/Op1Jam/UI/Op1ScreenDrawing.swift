// What the OP-1's screen shows at each step of a card. Line art in the
// screen's own pale blue, like the tape screen in the photos; the labels
// are ours, placed so each sits over the key that picks it (the screen
// spans exactly T1–T4). A port of op1-screen.ts, drawn straight into the
// device drawing's context, scaled from the 512 × 256 the original uses.

import Foundation
import SwiftUI

enum ScreenState {
    case reels, com, op1, synth, drum, tape, ext
}

struct Op1ScreenDrawing {
    static let width = 512.0
    static let height = 256.0

    private static let background = Color(hex: 0x07090c)
    private static let lineColor = Color(hex: 0x9fb7dc)
    private static let text = Color(hex: 0xe9edf3)
    private static let dim = Color(hex: 0x5d6878)
    private static let orange = Color(hex: 0xef6a2c)
    private static let green = Color(hex: 0x2fbf62)

    let rect: CGRect
    private var k: CGFloat { rect.width / Op1ScreenDrawing.width }

    private func at(_ x: Double, _ y: Double) -> CGPoint {
        CGPoint(x: rect.minX + x * k, y: rect.minY + y * k)
    }

    private func label(_ g: inout GraphicsContext, _ s: String, _ x: Double, _ y: Double, _ size: Double, _ color: Color, weight: Font.Weight = .medium) {
        g.draw(
            Text(s).font(.system(size: size * k, weight: weight, design: .monospaced)).foregroundStyle(color),
            at: at(x, y), anchor: .center)
    }

    private func stroke(_ g: inout GraphicsContext, _ path: Path, _ color: Color, width: Double = 3) {
        g.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: width * k, lineCap: .round))
    }

    private func line(_ g: inout GraphicsContext, _ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double, _ color: Color) {
        var p = Path()
        p.move(to: at(x1, y1))
        p.addLine(to: at(x2, y2))
        stroke(&g, p, color)
    }

    private func reel(_ g: inout GraphicsContext, _ x: Double, _ y: Double, _ r: Double) {
        let c = at(x, y)
        stroke(&g, Path(ellipseIn: CGRect(x: c.x - r * k, y: c.y - r * k, width: 2 * r * k, height: 2 * r * k)), Op1ScreenDrawing.lineColor)
        let inner = r * 0.22
        stroke(&g, Path(ellipseIn: CGRect(x: c.x - inner * k, y: c.y - inner * k, width: 2 * inner * k, height: 2 * inner * k)), Op1ScreenDrawing.lineColor)
        for i in 0..<3 {
            let a = -Double.pi / 2 + Double(i) * Double.pi * 2 / 3
            line(&g, x + cos(a) * r * 0.3, y + sin(a) * r * 0.3, x + cos(a) * r * 0.85, y + sin(a) * r * 0.85, Op1ScreenDrawing.lineColor)
        }
    }

    func draw(_ g: inout GraphicsContext, state: ScreenState) {
        let W = Op1ScreenDrawing.width
        let H = Op1ScreenDrawing.height
        g.fill(Path(roundedRect: rect, cornerRadius: 1.5), with: .color(Op1ScreenDrawing.background))
        let quarter = { (i: Int) -> Double in W / 4 * (Double(i) + 0.5) }

        switch state {
        case .com:
            label(&g, "COM", W / 2, 62, 52, Op1ScreenDrawing.text, weight: .semibold)
            for (i, s) in ["OP-1", "CTRL", "DISK", "OPT"].enumerated() {
                label(&g, s, quarter(i), H - 46, 30, i == 0 ? Op1ScreenDrawing.orange : Op1ScreenDrawing.lineColor, weight: i == 0 ? .bold : .medium)
                line(&g, quarter(i), H - 22, quarter(i), H - 6, i == 0 ? Op1ScreenDrawing.orange : Op1ScreenDrawing.dim)
            }
        case .op1:
            label(&g, "OP-1", W / 2, 92, 72, Op1ScreenDrawing.text, weight: .bold)
            label(&g, "MIDI ch 1 · USB", W / 2, 178, 30, Op1ScreenDrawing.lineColor)
        case .ext:
            label(&g, "EXT", W / 2, 100, 84, Op1ScreenDrawing.text, weight: .bold)
            label(&g, "sync", W / 2, 188, 34, Op1ScreenDrawing.green, weight: .semibold)
        case .synth:
            var wave = Path()
            var x = 40.0
            while x <= W - 40 {
                let y = H * 0.42 + sin((x - 40) / 22) * 46 + sin((x - 40) / 7) * 6
                if x == 40 { wave.move(to: at(x, y)) } else { wave.addLine(to: at(x, y)) }
                x += 2
            }
            stroke(&g, wave, Op1ScreenDrawing.lineColor)
            label(&g, "synth · 1–8", W / 2, H - 34, 30, Op1ScreenDrawing.lineColor)
        case .drum:
            let heights = [70.0, 30, 50, 30, 70, 30, 50, 38, 70, 30, 50, 30]
            for i in 0..<12 {
                let x = 52 + Double(i) * 37
                line(&g, x, H * 0.6, x, H * 0.6 - heights[i], Op1ScreenDrawing.lineColor)
            }
            label(&g, "drum · 1–8", W / 2, H - 34, 30, Op1ScreenDrawing.lineColor)
        case .reels, .tape:
            let r = 78.0
            reel(&g, W * 0.3, H * 0.52, r)
            reel(&g, W * 0.7, H * 0.52, r)
            line(&g, W * 0.3, H * 0.52 + r, W * 0.7, H * 0.52 + r, Op1ScreenDrawing.lineColor)
            label(&g, "0:00:00", W / 2, 30, 28, Op1ScreenDrawing.text)
            let tape = state == .tape
            let box = CGRect(x: rect.minX + 16 * k, y: rect.minY + 14 * k, width: 34 * k, height: 34 * k)
            stroke(&g, Path(box), tape ? Op1ScreenDrawing.orange : Op1ScreenDrawing.lineColor)
            label(&g, tape ? "1" : "4", 33, 32, 26, tape ? Op1ScreenDrawing.orange : Op1ScreenDrawing.text, weight: .semibold)
        }
    }
}
