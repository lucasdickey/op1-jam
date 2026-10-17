// The OP-1 as a flat drawing, from the layout in Op1Layout.swift: the keys
// as rounded squares in their grid positions, the encoders, the screen, the
// keyboard, and the right-hand edge folded out beside it. Keys a step says
// to hold get a dark ring, keys to press an orange one. Our own drawing,
// placed from photos of a real OP-1; none of teenage engineering's artwork.
// The flat Op1Drawing from op1-device.tsx; the 3D one (op1-3d.ts) is not
// ported.

import Foundation
import SwiftUI

/// The drawing's colours: the body's aluminium, the tiles, the key caps.
private enum Paint {
    static let body = Color(hex: 0xd9dadc)
    static let tile = Color(hex: 0xe9eaec)
    static let cap = Color(hex: 0xfafafa)
    static let hole = Color(hex: 0x9a9da3)
    static let well = Color(hex: 0xc8c9cc)
    static let pill = Color(hex: 0xf5f5f3)
    static let black = Color(hex: 0x1c1e21)
    static let edgeBody = Color(hex: 0xcfd0d3)
    static let ring = Color(hex: 0x1c1e21)
    static let lit = Color(hex: 0xef6a2c)
}

struct Op1Drawing: View {
    var hold: [KeyId] = []
    var press: [KeyId] = []
    var screen: ScreenState = .reels

    // Grid pitch, a key's side, the margin round the grid, all in the
    // drawing's own units; the Canvas scales them to fit.
    private static let pitch = 20.0
    private static let unit = 18.4
    private static let margin = 10.0
    private static let edgeWidth = 26.0
    static let width = Double(Op1Layout.cols) * pitch + 2 * margin
    static let height = Double(Op1Layout.rows) * pitch + 2 * margin
    static let aspect = (width + edgeWidth) / height

    private enum Mark {
        case hold, press
    }

    private func state(_ id: KeyId) -> Mark? {
        if hold.contains(id) { return .hold }
        if press.contains(id) { return .press }
        return nil
    }

    var body: some View {
        Canvas { context, size in
            let k = min(size.width / (Op1Drawing.width + Op1Drawing.edgeWidth), size.height / Op1Drawing.height)
            var g = context
            g.scaleBy(x: k, y: k)
            draw(&g)
        }
        .aspectRatio(Op1Drawing.aspect, contentMode: .fit)
        .accessibilityHidden(true)
    }

    // MARK: - Positions

    private func gx(_ c: Double) -> Double { Op1Drawing.margin + c * Op1Drawing.pitch + (Op1Drawing.pitch - Op1Drawing.unit) / 2 }
    private func gy(_ r: Double) -> Double { Op1Drawing.margin + r * Op1Drawing.pitch + (Op1Drawing.pitch - Op1Drawing.unit) / 2 }
    private func span(_ n: Double) -> Double { n * Op1Drawing.pitch - (Op1Drawing.pitch - Op1Drawing.unit) }

    private func tile(_ x: Double, _ y: Double, _ w: Double, _ h: Double, radius: Double = 3) -> Path {
        Path(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerRadius: radius)
    }

    private func circle(_ cx: Double, _ cy: Double, _ r: Double) -> Path {
        Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: 2 * r, height: 2 * r))
    }

    /// The ring round a key, knob or port a beat points at.
    private func mark(_ g: inout GraphicsContext, _ path: Path, _ state: Mark?) {
        guard let state = state else { return }
        switch state {
        case .hold:
            g.stroke(path, with: .color(Paint.ring), lineWidth: 1.6)
        case .press:
            g.stroke(path, with: .color(Paint.lit.opacity(0.35)), lineWidth: 4)
            g.stroke(path, with: .color(Paint.lit), lineWidth: 1.6)
        }
    }

    // MARK: - Drawing

    private func draw(_ g: inout GraphicsContext) {
        let U = Op1Drawing.unit
        let P = Op1Drawing.pitch
        let M = Op1Drawing.margin
        let W = Op1Drawing.width
        let H = Op1Drawing.height

        g.fill(tile(1, 1, W - 2, H - 2, radius: 8), with: .color(Paint.body))

        // The speaker: a round patch of holes.
        let sp = Op1Layout.speaker
        g.fill(tile(gx(Double(sp.col)), gy(Double(sp.row)), span(Double(sp.w)), span(Double(sp.h))), with: .color(Paint.tile))
        for y in 0..<7 {
            for x in 0..<7 where hypot(Double(x - 3), Double(y - 3)) <= 3.3 {
                let px = gx(0) + span(2) / 2 + Double(x - 3) * 4.4
                let py = gy(0) + span(2) / 2 + Double(y - 3) * 4.4
                g.fill(circle(px, py, 1.1), with: .color(Paint.hole))
            }
        }

        // The volume knob, left of the screen.
        let vol = Op1Layout.volume
        g.fill(tile(gx(Double(vol.col)), gy(Double(vol.row)), span(Double(vol.w)), span(1)), with: .color(Paint.tile))
        let vx = M + vol.knobCol * P
        let vy = gy(0) + U / 2
        g.fill(circle(vx, vy, 6), with: .color(Color(hex: 0xf4f4f2)))
        var volMark = Path()
        volMark.move(to: CGPoint(x: vx, y: vy))
        volMark.addLine(to: CGPoint(x: vx, y: vy - 5))
        g.stroke(volMark, with: .color(Paint.black), lineWidth: 1.2)
        mark(&g, circle(vx, vy, 7.5), state(.volume))

        // The screen, spanning T1–T4.
        let sc = Op1Layout.screen
        g.fill(tile(gx(Double(sc.col)), gy(Double(sc.row)), span(Double(sc.w)), span(Double(sc.h))), with: .color(Paint.tile))
        let screenRect = CGRect(
            x: gx(Double(sc.col)) + 2, y: gy(Double(sc.row)) + 2,
            width: span(Double(sc.w)) - 4, height: span(Double(sc.h)) - 4)
        Op1ScreenDrawing(rect: screenRect).draw(&g, state: screen)

        // The four encoders.
        for e in Op1Layout.encoders {
            let x = gx(Double(e.col)) + span(2) / 2
            let y = gy(0) + span(2) / 2
            g.fill(tile(gx(Double(e.col)), gy(0), span(2), span(2)), with: .color(Paint.tile))
            g.fill(circle(x, y, 11), with: .color(Paint.well))
            g.fill(circle(x, y, 7), with: .color(Color(hex: e.color)))
            var knobMark = Path()
            knobMark.move(to: CGPoint(x: x, y: y - 4.5))
            knobMark.addLine(to: CGPoint(x: x, y: y + 4.5))
            g.stroke(knobMark, with: .color(Paint.black.opacity(e.id == .white ? 0.8 : 0.5)), lineWidth: 1.2)
            mark(&g, circle(x, y, 12), state(e.id))
        }

        // The keys.
        for key in Op1Layout.keys {
            let x = gx(Double(key.col))
            let y = gy(Double(key.row))
            g.fill(tile(x, y, U, U), with: .color(Paint.tile))
            let capPath = circle(x + U / 2, y + U / 2, U / 2 - 2)
            g.fill(capPath, with: .color(key.solid ? Color(hex: Op1Layout.ink(.orange)) : Paint.cap))
            let word = key.glyph.count > 2
            let inkColor = key.solid ? Color.white : Color(hex: Op1Layout.ink(key.ink))
            g.draw(
                Text(key.glyph)
                    .font(.system(size: word ? 4.2 : 7, weight: .semibold, design: .monospaced))
                    .foregroundStyle(inkColor),
                at: CGPoint(x: x + U / 2, y: y + U / 2 + (key.sub != nil ? -2 : 0.3)), anchor: .center)
            if let sub = key.sub {
                g.draw(
                    Text(sub)
                        .font(.system(size: 3.2, weight: .semibold, design: .monospaced))
                        .foregroundStyle(Color(hex: Op1Layout.ink(key.subInk ?? key.ink))),
                    at: CGPoint(x: x + U / 2, y: y + U / 2 + 4.6), anchor: .center)
            }
            mark(&g, capPath, state(key.id))
        }

        // The keyboard: black keys on the row above fourteen white keys, F to E.
        let kb = Op1Layout.keyboard
        let pianoState = state(.piano)
        for i in 0..<Op1Layout.whiteKeys {
            g.fill(tile(gx(Double(kb.col + i)), gy(Double(kb.row - 1)), U, U), with: .color(Paint.tile))
        }
        for i in 0..<Op1Layout.whiteKeys {
            let x = gx(Double(kb.col + i))
            g.fill(tile(x, gy(Double(kb.row)), U, span(2)), with: .color(Paint.tile))
            let pillPath = tile(x + U / 2 - 4.5, gy(Double(kb.row)) + 4, 9, span(2) - 8, radius: 4.5)
            let isLit = i == Op1Layout.litKey && pianoState != nil
            g.fill(pillPath, with: .color(isLit ? Paint.lit : Paint.pill))
            if isLit { mark(&g, pillPath, pianoState) }
        }
        for after in Op1Layout.blackAfter {
            g.fill(circle(M + Double(kb.col + after + 1) * P, gy(Double(kb.row - 1)) + U / 2, 5.4), with: .color(Paint.black))
        }

        // The right-hand edge, folded out beside it: switch, USB, line in, headphones.
        let edgeX = W + 8
        let ez = { (mmFromFront: Double) -> Double in
            M + ((Op1Layout.Edge.depth - mmFromFront) / Op1Layout.Edge.depth) * Double(Op1Layout.rows) * P
        }
        g.fill(tile(edgeX, M, 12, Double(Op1Layout.rows) * P), with: .color(Paint.edgeBody))
        for slot in Op1Layout.Edge.slots {
            g.fill(tile(edgeX + 4.5, ez(slot) - 1, 3, 2, radius: 1), with: .color(Paint.hole))
        }
        let power = Op1Layout.Edge.power
        let slotPath = tile(edgeX + 3, ez(power.at) - 5, 6, 10 + power.travel, radius: 3)
        g.fill(slotPath, with: .color(Paint.hole))
        let nubY = state(.power) == nil ? ez(power.at) - 4.5 : ez(power.at) - 4.5 + power.travel
        g.fill(tile(edgeX + 3.5, nubY, 5, 9, radius: 2.5), with: .color(Paint.pill))
        mark(&g, slotPath, state(.power))
        let usbPath = tile(edgeX + 3.5, ez(Op1Layout.Edge.usb) - 3.5, 5, 7, radius: 1)
        g.fill(usbPath, with: .color(Paint.black))
        mark(&g, usbPath, state(.usb))
        for jack in Op1Layout.Edge.jacks {
            let jackPath = circle(edgeX + 6, ez(jack.at), 2.6)
            g.fill(jackPath, with: .color(Paint.black))
            g.stroke(jackPath, with: .color(Color(hex: jack.ring)), lineWidth: 1)
            mark(&g, circle(edgeX + 6, ez(jack.at), 4), state(jack.id))
        }
    }
}
