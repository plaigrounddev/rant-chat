import SwiftUI

// MARK: - Home View

/// Main screen with large mic button, status indicators, and quick stats.
struct HomeView: View {
    @State private var viewModel = HomeViewModel()
    @Environment(NetworkMonitor.self) private var networkMonitor
    @Environment(MemPalaceManager.self) private var memPalace

    var body: some View {
        NavigationStack {
            ZStack {
                // Background gradient
                LinearGradient(
                    colors: [
                        Color(.systemBackground),
                        Color.accentColor.opacity(0.05),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()

                VStack(spacing: 32) {
                    // Status bar
                    statusBar

                    Spacer()

                    // Transcription / result display
                    transcriptionDisplay

                    // Mic button
                    micButton

                    Spacer()

                    // Quick stats
                    statsBar
                }
                .padding()
            }
            .navigationTitle("AuraOS")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    StatusBadge(
                        isOnline: networkMonitor.isConnected,
                        connectionType: networkMonitor.statusText
                    )
                }
            }
        }
    }

    // MARK: - Status Bar

    private var statusBar: some View {
        HStack(spacing: 12) {
            // Model status
            HStack(spacing: 4) {
                Image(systemName: LLMService.shared.isLoaded ? "brain" : "brain.head.profile")
                    .foregroundStyle(LLMService.shared.isLoaded ? .green : .gray)
                Text(LLMService.shared.isLoaded ? "AI Ready" : "AI Loading...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            // Pipeline state
            if case .idle = viewModel.pipeline.state {
                // Show nothing when idle
            } else {
                pipelineStateIndicator
            }
        }
    }

    // MARK: - Pipeline State

    @ViewBuilder
    private var pipelineStateIndicator: some View {
        switch viewModel.pipeline.state {
        case .recording:
            HStack(spacing: 4) {
                Circle()
                    .fill(.red)
                    .frame(width: 8, height: 8)
                    .pulseAnimation()
                Text("Recording \(viewModel.pipeline.formattedDuration)")
                    .font(.caption)
                    .monospacedDigit()
            }
        case .transcribing:
            HStack(spacing: 4) {
                ProgressView()
                    .scaleEffect(0.7)
                Text("Transcribing...")
                    .font(.caption)
            }
        case .parsing:
            HStack(spacing: 4) {
                ProgressView()
                    .scaleEffect(0.7)
                Text("Understanding...")
                    .font(.caption)
            }
        case .executing(let description):
            HStack(spacing: 4) {
                ProgressView()
                    .scaleEffect(0.7)
                Text(description)
                    .font(.caption)
                    .lineLimit(1)
            }
        case .completed:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .error:
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
        case .idle:
            EmptyView()
        }
    }

    // MARK: - Transcription Display

    private var transcriptionDisplay: some View {
        VStack(spacing: 12) {
            if let transcription = viewModel.pipeline.lastTranscription {
                Text(transcription)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.center)
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
            }

            if case .completed(let result) = viewModel.pipeline.state {
                Text(result)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            if case .error(let message) = viewModel.pipeline.state {
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
        }
        .animation(.spring(duration: 0.3), value: viewModel.pipeline.lastTranscription)
    }

    // MARK: - Mic Button

    private var micButton: some View {
        PulsingMicButton(
            isRecording: viewModel.pipeline.isRecording,
            audioLevel: viewModel.pipeline.audioLevel,
            onTap: {
                Task {
                    await viewModel.toggleRecording()
                }
            }
        )
    }

    // MARK: - Stats Bar

    private var statsBar: some View {
        HStack(spacing: 24) {
            statItem(
                icon: "brain.head.profile",
                label: "Memories",
                count: memPalace.memoryCount
            )
            statItem(
                icon: "note.text",
                label: "Notes",
                count: memPalace.noteCount
            )
            statItem(
                icon: "bolt.fill",
                label: "Pending",
                count: memPalace.pendingActionCount,
                highlight: memPalace.pendingActionCount > 0
            )
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    private func statItem(icon: String, label: String, count: Int, highlight: Bool = false) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(highlight ? .orange : .accentColor)
            Text("\(count)")
                .font(.headline)
                .monospacedDigit()
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(minWidth: 70)
    }
}

// MARK: - Pulse Animation

extension View {
    func pulseAnimation() -> some View {
        modifier(PulseAnimationModifier())
    }
}

struct PulseAnimationModifier: ViewModifier {
    @State private var isAnimating = false

    func body(content: Content) -> some View {
        content
            .opacity(isAnimating ? 0.3 : 1.0)
            .animation(
                .easeInOut(duration: 0.8).repeatForever(autoreverses: true),
                value: isAnimating
            )
            .onAppear { isAnimating = true }
    }
}

#Preview {
    HomeView()
        .environment(NetworkMonitor.shared)
        .environment(MemPalaceManager.shared)
        .environment(ModelDownloadManager.shared)
}
