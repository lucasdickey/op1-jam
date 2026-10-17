// swift-tools-version:5.9
// OP-1 Jam as a native Mac app.
//
// Two targets. Op1Core is plain Swift with no Apple frameworks: the loop's
// types, the words Claude gets, hum-to-notes, and the player's timing. It
// builds and tests on Linux as well as a Mac (`swift test`). Op1Jam is the
// Mac app around it: SwiftUI, CoreMIDI, AVFoundation, the Keychain. It is
// only declared on a Mac, so `swift build` elsewhere builds just the core.
import PackageDescription

var targets: [Target] = [
    .target(name: "Op1Core", path: "Sources/Op1Core"),
    .testTarget(name: "Op1CoreTests", dependencies: ["Op1Core"], path: "Tests/Op1CoreTests"),
]
var products: [Product] = [
    .library(name: "Op1Core", targets: ["Op1Core"]),
]
#if os(macOS)
targets.append(
    .executableTarget(
        name: "Op1Jam",
        dependencies: ["Op1Core"],
        path: "Sources/Op1Jam",
        resources: [.process("Resources")]
    )
)
products.append(.executable(name: "Op1Jam", targets: ["Op1Jam"]))
#endif

let package = Package(
    name: "Op1Jam",
    platforms: [.macOS(.v14)],
    products: products,
    targets: targets
)
