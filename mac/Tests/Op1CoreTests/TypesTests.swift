import XCTest
@testable import Op1Core

final class TypesTests: XCTestCase {
    func testNoteName() {
        XCTAssertEqual(noteName(60), "C4")
        XCTAssertEqual(noteName(61), "C#4")
        XCTAssertEqual(noteName(59), "B3")
        XCTAssertEqual(noteName(0), "C-1")
    }

    func testLoopBarsSteps() {
        XCTAssertEqual(LoopBars.four.steps, 64)
    }

    func testPatternRequestRoundTripsThroughJSON() throws {
        let req = PatternRequest(
            part: .bass, tempo: 120, bars: .two, direction: "dubby", newDirection: true,
            current: Pattern(bars: .two, notes: [PatternNote(step: 0, note: 36, length: 2)]),
            heard: [HeardNote(note: 40, step: nil, loopsAgo: nil, length: nil)],
            drumKeys: [], tape: [])
        let data = try JSONEncoder().encode(req)
        XCTAssertEqual(try JSONDecoder().decode(PatternRequest.self, from: data), req)
        let json = String(decoding: data, as: UTF8.self)
        XCTAssertTrue(json.contains("\"bars\":2"))
        XCTAssertTrue(json.contains("\"part\":\"bass\""))
    }
}
