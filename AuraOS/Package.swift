// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AuraOS",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "AuraOSLib",
            targets: ["AuraOSLib"]
        )
    ],
    dependencies: [
        // On-device LLM inference (Gemma 4 via llama.cpp)
        .package(url: "https://github.com/mattt/llama.swift.git", .upToNextMajor(from: "2.8628.0")),

        // On-device audio transcription (Whisper)
        .package(url: "https://github.com/ggml-org/whisper.cpp.git", .upToNextMajor(from: "1.5.0")),

        // Local SQLite database for MemPalace
        .package(url: "https://github.com/stephencelis/SQLite.swift.git", .upToNextMajor(from: "0.16.0")),
    ],
    targets: [
        .target(
            name: "AuraOSLib",
            dependencies: [
                .product(name: "llama", package: "llama.swift"),
                .product(name: "whisper", package: "whisper.cpp"),
                .product(name: "SQLite", package: "SQLite.swift"),
            ],
            path: "AuraOS"
        ),
        .testTarget(
            name: "AuraOSTests",
            dependencies: ["AuraOSLib"],
            path: "AuraOSTests"
        ),
    ]
)
