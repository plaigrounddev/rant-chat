import SwiftUI

// MARK: - Waveform View

/// Audio level visualization that shows mic input levels as animated bars.
struct WaveformView: View {
    let audioLevel: Float
    let barCount: Int
    let isActive: Bool

    @State private var levels: [CGFloat]

    init(audioLevel: Float = 0, barCount: Int = 20, isActive: Bool = false) {
        self.audioLevel = audioLevel
        self.barCount = barCount
        self.isActive = isActive
        self._levels = State(initialValue: Array(repeating: 0.1, count: barCount))
    }

    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<barCount, id: \.self) { index in
                RoundedRectangle(cornerRadius: 2)
                    .fill(barColor(for: index))
                    .frame(width: 3, height: barHeight(for: index))
                    .animation(
                        .spring(duration: 0.15, bounce: 0.3).delay(Double(index) * 0.01),
                        value: levels[index]
                    )
            }
        }
        .frame(height: 40)
        .onChange(of: audioLevel) { _, newLevel in
            updateLevels(newLevel)
        }
        .onChange(of: isActive) { _, active in
            if !active {
                resetLevels()
            }
        }
    }

    private func barHeight(for index: Int) -> CGFloat {
        let minHeight: CGFloat = 4
        let maxHeight: CGFloat = 40
        return minHeight + (maxHeight - minHeight) * levels[index]
    }

    private func barColor(for index: Int) -> Color {
        if !isActive { return .gray.opacity(0.3) }

        let level = levels[index]
        if level > 0.7 { return .red }
        if level > 0.4 { return .orange }
        return .accentColor
    }

    private func updateLevels(_ level: Float) {
        guard isActive else { return }

        var newLevels = levels
        // Shift levels left
        for i in 0..<(barCount - 1) {
            newLevels[i] = newLevels[i + 1]
        }
        // Add new level with some randomness for visual interest
        let baseLevel = CGFloat(level)
        let randomFactor = CGFloat.random(in: 0.7...1.3)
        newLevels[barCount - 1] = min(1.0, baseLevel * randomFactor)

        levels = newLevels
    }

    private func resetLevels() {
        levels = Array(repeating: 0.1, count: barCount)
    }
}

#Preview {
    VStack(spacing: 20) {
        WaveformView(audioLevel: 0.5, isActive: true)
        WaveformView(audioLevel: 0.2, isActive: true)
        WaveformView(audioLevel: 0, isActive: false)
    }
    .padding()
}
