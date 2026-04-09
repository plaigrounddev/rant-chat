import SwiftUI

// MARK: - Pulsing Mic Button

/// Large animated mic button for the home screen.
/// Pulses when recording with audio level visualization.
struct PulsingMicButton: View {
    let isRecording: Bool
    let audioLevel: Float
    let onTap: () -> Void

    @State private var pulseScale: CGFloat = 1.0
    @State private var outerRingScale: CGFloat = 1.0

    private let buttonSize: CGFloat = 80
    private let outerRingSize: CGFloat = 120

    var body: some View {
        ZStack {
            // Outer pulsing ring (audio level)
            if isRecording {
                Circle()
                    .fill(Color.red.opacity(0.1))
                    .frame(width: outerRingSize + CGFloat(audioLevel * 40))
                    .scaleEffect(outerRingScale)

                Circle()
                    .stroke(Color.red.opacity(0.3), lineWidth: 2)
                    .frame(width: outerRingSize + CGFloat(audioLevel * 40))
                    .scaleEffect(outerRingScale)
            }

            // Middle ring
            Circle()
                .fill(isRecording ? Color.red.opacity(0.15) : Color.accentColor.opacity(0.1))
                .frame(width: buttonSize + 20)
                .scaleEffect(pulseScale)

            // Main button
            Button(action: onTap) {
                Circle()
                    .fill(isRecording ? Color.red : Color.accentColor)
                    .frame(width: buttonSize, height: buttonSize)
                    .overlay {
                        Image(systemName: isRecording ? "stop.fill" : "mic.fill")
                            .font(.system(size: 30))
                            .foregroundStyle(.white)
                    }
                    .shadow(
                        color: (isRecording ? Color.red : Color.accentColor).opacity(0.3),
                        radius: 16,
                        y: 4
                    )
            }
            .buttonStyle(.plain)
        }
        .frame(width: outerRingSize + 60, height: outerRingSize + 60)
        .onChange(of: isRecording) { _, recording in
            if recording {
                startPulseAnimation()
            } else {
                stopPulseAnimation()
            }
        }
        .sensoryFeedback(.impact, trigger: isRecording)
    }

    private func startPulseAnimation() {
        withAnimation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true)) {
            pulseScale = 1.08
            outerRingScale = 1.05
        }
    }

    private func stopPulseAnimation() {
        withAnimation(.easeInOut(duration: 0.3)) {
            pulseScale = 1.0
            outerRingScale = 1.0
        }
    }
}

#Preview {
    VStack(spacing: 40) {
        PulsingMicButton(isRecording: false, audioLevel: 0, onTap: {})
        PulsingMicButton(isRecording: true, audioLevel: 0.5, onTap: {})
    }
}
