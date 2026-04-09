import SwiftUI

// MARK: - Onboarding View

/// First-launch experience: model download + permission setup.
struct OnboardingView: View {
    @Environment(ModelDownloadManager.self) private var modelManager
    @State private var currentStep: OnboardingStep = .welcome
    @State private var isDownloading = false
    @State private var downloadError: String?

    enum OnboardingStep {
        case welcome
        case download
        case permissions
        case ready
    }

    var body: some View {
        ZStack {
            // Background
            LinearGradient(
                colors: [
                    Color.accentColor.opacity(0.1),
                    Color(.systemBackground),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                switch currentStep {
                case .welcome:
                    welcomeStep
                case .download:
                    downloadStep
                case .permissions:
                    permissionsStep
                case .ready:
                    readyStep
                }
            }
        }
    }

    // MARK: - Welcome Step

    private var welcomeStep: some View {
        VStack(spacing: 24) {
            Spacer()

            // Logo / Icon
            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 80))
                .foregroundStyle(.accentColor)
                .symbolEffect(.pulse)

            Text("AuraOS")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("Your Personal AI, On-Device")
                .font(.title3)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 16) {
                featureRow(icon: "brain.head.profile", title: "Fully Offline AI", description: "Gemma 4 runs on your device — no internet needed")
                featureRow(icon: "mic.fill", title: "Voice-First", description: "Capture notes, commands, and ideas by speaking")
                featureRow(icon: "lock.shield.fill", title: "Private by Default", description: "Your data stays on your phone, always")
                featureRow(icon: "bolt.fill", title: "System Control", description: "Control your phone with natural language")
            }
            .padding(.horizontal, 32)
            .padding(.top, 16)

            Spacer()

            Button {
                withAnimation { currentStep = .download }
            } label: {
                Text("Get Started")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(.accentColor, in: RoundedRectangle(cornerRadius: 16))
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, 32)
            .padding(.bottom, 48)
        }
    }

    // MARK: - Download Step

    private var downloadStep: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "arrow.down.circle.fill")
                .font(.system(size: 60))
                .foregroundStyle(.accentColor)

            Text("Download AI Models")
                .font(.title2)
                .fontWeight(.bold)

            Text("AuraOS needs to download AI models for offline inference. This is a one-time setup.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            // Model info
            VStack(spacing: 12) {
                ForEach(ModelDownloadManager.allModels, id: \.fileName) { model in
                    HStack {
                        Image(systemName: "cube.fill")
                            .foregroundStyle(.accentColor)
                        VStack(alignment: .leading) {
                            Text(model.name)
                                .font(.subheadline)
                                .fontWeight(.medium)
                            Text(ByteCountFormatter.string(fromByteCount: model.expectedSizeBytes, countStyle: .file))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()

                        let progress = modelManager.modelProgress[model.fileName] ?? 0
                        if progress >= 1.0 {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                        } else if isDownloading {
                            ProgressView(value: progress)
                                .frame(width: 60)
                        }
                    }
                    .padding()
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .padding(.horizontal, 32)

            // Overall progress
            if isDownloading {
                VStack(spacing: 8) {
                    ProgressView(value: modelManager.overallProgress)
                        .padding(.horizontal, 32)

                    if let modelName = modelManager.currentModelName {
                        Text("Downloading \(modelName)...")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if let error = downloadError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 32)
            }

            Spacer()

            VStack(spacing: 12) {
                HStack {
                    Image(systemName: "wifi")
                        .font(.caption)
                    Text("Total: \(modelManager.totalDownloadSizeFormatted)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Button {
                    Task {
                        isDownloading = true
                        downloadError = nil
                        do {
                            try await modelManager.downloadAllModels()
                            withAnimation { currentStep = .permissions }
                        } catch {
                            downloadError = error.localizedDescription
                        }
                        isDownloading = false
                    }
                } label: {
                    Text(isDownloading ? "Downloading..." : "Download Models")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(isDownloading ? .gray : .accentColor, in: RoundedRectangle(cornerRadius: 16))
                        .foregroundStyle(.white)
                }
                .disabled(isDownloading)
                .padding(.horizontal, 32)

                if !isDownloading {
                    Button("Skip for Now") {
                        withAnimation { currentStep = .permissions }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
            .padding(.bottom, 48)
        }
    }

    // MARK: - Permissions Step

    private var permissionsStep: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "shield.checkered")
                .font(.system(size: 60))
                .foregroundStyle(.accentColor)

            Text("Enable Permissions")
                .font(.title2)
                .fontWeight(.bold)

            Text("AuraOS needs access to your microphone and other features to work.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            VStack(spacing: 12) {
                ForEach(PermissionManager.PermissionType.allCases) { type in
                    HStack {
                        Image(systemName: type.icon)
                            .foregroundStyle(.accentColor)
                            .frame(width: 24)

                        VStack(alignment: .leading) {
                            HStack {
                                Text(type.displayName)
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                if type.isRequired {
                                    Text("Required")
                                        .font(.caption2)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(.orange.opacity(0.2), in: Capsule())
                                        .foregroundStyle(.orange)
                                }
                            }
                            Text(type.description)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        let status = PermissionManager.shared.permissionStatuses[type] ?? .unknown
                        Image(systemName: status == .granted ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(status == .granted ? .green : .gray)
                    }
                    .padding(.vertical, 4)
                }
            }
            .padding(.horizontal, 32)

            Spacer()

            VStack(spacing: 12) {
                Button {
                    Task {
                        await PermissionManager.shared.requestAllPermissions()
                        withAnimation { currentStep = .ready }
                    }
                } label: {
                    Text("Grant Permissions")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(.accentColor, in: RoundedRectangle(cornerRadius: 16))
                        .foregroundStyle(.white)
                }
                .padding(.horizontal, 32)

                Button("Skip for Now") {
                    withAnimation { currentStep = .ready }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .padding(.bottom, 48)
        }
    }

    // MARK: - Ready Step

    private var readyStep: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 80))
                .foregroundStyle(.green)

            Text("You're All Set!")
                .font(.title)
                .fontWeight(.bold)

            Text("AuraOS is ready. Tap the mic to start capturing.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            Spacer()

            Button {
                // Load models and transition to main app
                Task {
                    if LLMService.isGemmaModelDownloaded {
                        try? await LLMService.shared.loadModel(path: LLMService.gemmaModelPath.path)
                    }
                    if WhisperService.isWhisperModelDownloaded {
                        try? await WhisperService.shared.loadModel(path: WhisperService.whisperModelPath.path)
                    }
                    // Mark onboarding as complete (even if models were skipped)
                    modelManager.markOnboardingComplete()
                }
            } label: {
                Text("Start Using AuraOS")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(.accentColor, in: RoundedRectangle(cornerRadius: 16))
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, 32)
            .padding(.bottom, 48)
        }
    }

    // MARK: - Helpers

    private func featureRow(icon: String, title: String, description: String) -> some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(.accentColor)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

#Preview {
    OnboardingView()
        .environment(ModelDownloadManager.shared)
}
