// Getting started: the deck of cards from steps.tsx, in a sheet. One card
// at a time, Back and Next, a dot per card, and the fixes under "Something
// not working?".

import SwiftUI

struct StepsSheet: View {
    let connected: Bool
    let outputName: String?
    let onTest: () -> Void
    let onDone: () -> Void

    @State private var at = 0
    @State private var helpOpen = false

    private var slides: [Slide] { stepSlides(connected: connected, outputName: outputName) }

    var body: some View {
        let slides = self.slides
        let last = slides.count - 1
        let index = min(at, last)
        let slide = slides[index]

        VStack(alignment: .leading, spacing: 16) {
            HStack {
                PanelTitle(text: "Getting started")
                Spacer()
                LinkButton(title: "Hide", action: onDone)
            }

            ScrollView {
                StepCard(slide: slide, number: index + 1, connected: connected, onTest: onTest)
                    .id(slide.id)
            }
            .frame(minHeight: 320)

            HStack {
                Button("← Back") { go(index - 1) }
                    .disabled(index == 0)
                Spacer()
                HStack(spacing: 8) {
                    ForEach(Array(slides.enumerated()), id: \.element.id) { i, s in
                        Button {
                            go(i)
                        } label: {
                            Circle()
                                .fill(i == index ? Palette.orange : (s.optional ? Color.clear : Palette.rule))
                                .overlay(Circle().stroke(Palette.rule, lineWidth: 1))
                                .frame(width: 10, height: 10)
                        }
                        .buttonStyle(.plain)
                        .help("Step \(i + 1): \(s.title)")
                    }
                }
                Spacer()
                if index < last {
                    Button("Next →") { go(index + 1) }
                        .buttonStyle(.borderedProminent)
                        .tint(Palette.ink)
                } else {
                    Button("Done", action: onDone)
                        .buttonStyle(.borderedProminent)
                        .tint(Palette.ink)
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                LinkButton(title: helpOpen ? "Hide the fixes" : "Something not working?") { helpOpen.toggle() }
                if helpOpen {
                    ForEach(stepFixes, id: \.self) { fix in
                        Text(LocalizedStringKey(fix))
                            .font(.system(size: 12, design: .monospaced))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .padding(24)
        .frame(width: 760)
        .frame(minHeight: 520)
        .background(Palette.panel)
        .foregroundStyle(Palette.ink)
        .fontDesign(.monospaced)
        .onKeyPress(.rightArrow) {
            go(index + 1)
            return .handled
        }
        .onKeyPress(.leftArrow) {
            go(index - 1)
            return .handled
        }
    }

    private func go(_ i: Int) {
        at = max(0, min(slides.count - 1, i))
    }
}

/// One card: its number, title, points, and the OP-1 if it has a demo.
struct StepCard: View {
    let slide: Slide
    let number: Int
    let connected: Bool
    let onTest: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 18) {
            Text("\(number)")
                .font(.system(size: 44, weight: .bold, design: .monospaced))
                .foregroundStyle(Palette.orange)
                .frame(width: 48, alignment: .leading)
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(slide.title)
                        .font(.system(size: 22, weight: .bold, design: .monospaced))
                    if slide.optional {
                        Text("optional")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(Palette.dim)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .overlay(Capsule().stroke(Palette.rule, lineWidth: 1))
                    }
                }
                HStack(alignment: .top, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        if slide.id == "hear" {
                            HStack(spacing: 8) {
                                KeyButton(title: "Test sound", tone: Palette.white, action: onTest)
                                    .disabled(!connected)
                                Text("three rising notes")
                                    .font(.system(size: 12, design: .monospaced))
                                    .foregroundStyle(Palette.dim)
                            }
                        }
                        ForEach(Array(slide.points.enumerated()), id: \.offset) { _, point in
                            HStack(alignment: .top, spacing: 8) {
                                Text("•").foregroundStyle(Palette.orange)
                                Text(LocalizedStringKey(point))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .font(.system(size: 14, design: .monospaced))
                        }
                    }
                    if let demo = slide.demo {
                        Op1Demo(beats: demo, active: true)
                            .frame(maxWidth: 400)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
