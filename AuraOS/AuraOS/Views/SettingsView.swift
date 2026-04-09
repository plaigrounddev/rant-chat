import SwiftUI

// MARK: - Settings View

struct SettingsView: View {
    @Environment(NetworkMonitor.self) private var networkMonitor
    @Environment(ModelDownloadManager.self) private var modelManager
    @State private var convexURL: String = ConvexSyncService.shared.convexURL
    @State private var convexToken: String = ConvexSyncService.shared.convexToken
    @State private var autoExecute: Bool = ActionQueueManager.shared.autoExecute
    @State private var showClearConfirmation = false

    var body: some View {
        NavigationStack {
            Form {
                // Permissions
                permissionsSection

                // AI Models
                modelsSection

                // Convex Sync
                syncSection

                // Actions
                actionsSection

                // About
                aboutSection

                // Danger Zone
                dangerSection
            }
            .navigationTitle("Settings")
        }
    }

    // MARK: - Permissions Section

    private var permissionsSection: some View {
        Section("Permissions") {
            ForEach(PermissionManager.PermissionType.allCases) { type in
                HStack {
                    Image(systemName: type.icon)
                        .foregroundStyle(.accentColor)
                        .frame(width: 24)

                    VStack(alignment: .leading) {
                        Text(type.displayName)
                            .font(.body)
                        Text(type.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    let status = PermissionManager.shared.permissionStatuses[type] ?? .unknown
                    Text(status.displayName)
                        .font(.caption)
                        .fontWeight(.medium)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(statusColor(status).opacity(0.15), in: Capsule())
                        .foregroundStyle(statusColor(status))
                }
            }

            Button("Request All Permissions") {
                Task {
                    await PermissionManager.shared.requestAllPermissions()
                }
            }

            Button("Open System Settings") {
                PermissionManager.shared.openAppSettings()
            }
        }
    }

    // MARK: - Models Section

    private var modelsSection: some View {
        Section("AI Models") {
            ForEach(modelManager.modelStatuses, id: \.0.fileName) { (model, isDownloaded) in
                HStack {
                    VStack(alignment: .leading) {
                        Text(model.name)
                            .font(.body)
                        Text(model.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(ByteCountFormatter.string(fromByteCount: model.expectedSizeBytes, countStyle: .file))
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }

                    Spacer()

                    if isDownloaded {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    } else {
                        Image(systemName: "arrow.down.circle")
                            .foregroundStyle(.orange)
                    }
                }
            }

            if !modelManager.isReady {
                Button("Download Missing Models") {
                    Task {
                        try? await modelManager.downloadAllModels()
                    }
                }
            }
        }
    }

    // MARK: - Sync Section

    private var syncSection: some View {
        Section {
            HStack {
                Text("Status")
                Spacer()
                StatusBadge(
                    isOnline: networkMonitor.isConnected,
                    connectionType: networkMonitor.statusText
                )
            }

            TextField("Convex Deployment URL", text: $convexURL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onChange(of: convexURL) { _, newValue in
                    ConvexSyncService.shared.convexURL = newValue
                }

            SecureField("Convex Token", text: $convexToken)
                .textInputAutocapitalization(.never)
                .onChange(of: convexToken) { _, newValue in
                    ConvexSyncService.shared.convexToken = newValue
                }

            HStack {
                Text("Last Sync")
                Spacer()
                Text(ConvexSyncService.shared.lastSyncFormatted)
                    .foregroundStyle(.secondary)
            }

            if ConvexSyncService.shared.isConfigured && networkMonitor.isConnected {
                Button("Sync Now") {
                    Task {
                        await ConvexSyncService.shared.syncAll()
                    }
                }
            }
        } header: {
            Text("Cloud Sync (Convex)")
        } footer: {
            Text("Connect to your Convex deployment to sync memories, notes, and actions to the cloud.")
        }
    }

    // MARK: - Actions Section

    private var actionsSection: some View {
        Section("Action Queue") {
            Toggle("Auto-Execute When Online", isOn: $autoExecute)
                .onChange(of: autoExecute) { _, newValue in
                    ActionQueueManager.shared.autoExecute = newValue
                }

            HStack {
                Text("Pending Actions")
                Spacer()
                Text("\(ActionQueueManager.shared.pendingCount)")
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - About Section

    private var aboutSection: some View {
        Section("About") {
            HStack {
                Text("Version")
                Spacer()
                Text("1.0.0")
                    .foregroundStyle(.secondary)
            }

            HStack {
                Text("AI Engine")
                Spacer()
                Text("Gemma 4 2B (On-Device)")
                    .foregroundStyle(.secondary)
            }

            HStack {
                Text("Transcription")
                Spacer()
                Text("Whisper (On-Device)")
                    .foregroundStyle(.secondary)
            }

            HStack {
                Text("Memory System")
                Spacer()
                Text("MemPalace (SQLite + Vectors)")
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Danger Section

    private var dangerSection: some View {
        Section {
            Button("Clear All Data", role: .destructive) {
                showClearConfirmation = true
            }
            .confirmationDialog(
                "Clear All Data?",
                isPresented: $showClearConfirmation,
                titleVisibility: .visible
            ) {
                Button("Clear Everything", role: .destructive) {
                    // Delete database and reset
                    // Implementation: delete SQLite file and reinitialize
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will permanently delete all memories, notes, and pending actions. This cannot be undone.")
            }
        }
    }

    // MARK: - Helpers

    private func statusColor(_ status: PermissionManager.PermissionStatus) -> Color {
        switch status {
        case .granted: return .green
        case .denied: return .red
        case .restricted: return .orange
        case .notDetermined, .unknown: return .gray
        }
    }
}

#Preview {
    SettingsView()
        .environment(NetworkMonitor.shared)
        .environment(MemPalaceManager.shared)
        .environment(ModelDownloadManager.shared)
}
