import SwiftUI

// MARK: - Actions View (Pending Actions Tray)

/// Shows queued online actions with confirm/skip controls.
struct ActionsView: View {
    @State private var viewModel = ActionsViewModel()
    @Environment(NetworkMonitor.self) private var networkMonitor

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Connection status banner
                if !networkMonitor.isConnected {
                    offlineBanner
                }

                if viewModel.pendingActions.isEmpty && viewModel.completedActions.isEmpty {
                    emptyState
                } else {
                    actionsList
                }
            }
            .navigationTitle("Actions")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if !viewModel.pendingActions.isEmpty && networkMonitor.isConnected {
                        Button("Flush All") {
                            Task {
                                await viewModel.flushAll()
                            }
                        }
                        .disabled(viewModel.isExecuting)
                    }
                }
            }
            .onAppear {
                viewModel.refresh()
            }
        }
    }

    // MARK: - Offline Banner

    private var offlineBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.slash")
                .font(.caption)
            Text("You're offline — actions will execute when connected")
                .font(.caption)
            Spacer()
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(.orange.opacity(0.15))
        .foregroundStyle(.orange)
    }

    // MARK: - Actions List

    private var actionsList: some View {
        List {
            // Pending section
            if !viewModel.pendingActions.isEmpty {
                Section {
                    ForEach(viewModel.pendingActions) { action in
                        ActionCard(
                            action: action,
                            isOnline: networkMonitor.isConnected,
                            isExecuting: viewModel.isExecuting,
                            onConfirm: {
                                Task {
                                    await viewModel.confirmAction(id: action.id)
                                }
                            },
                            onSkip: {
                                viewModel.skipAction(id: action.id)
                            }
                        )
                    }
                } header: {
                    HStack {
                        Text("Pending")
                        Spacer()
                        Text("\(viewModel.pendingActions.count)")
                            .font(.caption)
                            .fontWeight(.medium)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(.orange.opacity(0.2), in: Capsule())
                    }
                }
            }

            // Completed section
            if !viewModel.completedActions.isEmpty {
                Section("History") {
                    ForEach(viewModel.completedActions) { action in
                        CompletedActionRow(action: action)
                    }
                    .onDelete { indices in
                        for index in indices {
                            let action = viewModel.completedActions[index]
                            viewModel.deleteAction(id: action.id)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "bolt.circle")
                .font(.system(size: 60))
                .foregroundStyle(.tertiary)
            Text("No Pending Actions")
                .font(.title2)
                .fontWeight(.semibold)
            Text("When you create actions that need internet (emails, Slack messages, calendar events), they'll appear here.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Spacer()
        }
    }
}

// MARK: - Completed Action Row

struct CompletedActionRow: View {
    let action: QueuedAction

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: action.type.icon)
                .font(.title3)
                .foregroundStyle(action.status == .completed ? .green : .red)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(action.title)
                    .font(.body)
                    .lineLimit(1)

                HStack(spacing: 4) {
                    Text(action.type.displayName)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if let executedAt = action.executedAt {
                        Text("•")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                        Text(DateHelpers.formatRelativeDate(executedAt))
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }

                if let error = action.errorMessage {
                    Text(error)
                        .font(.caption2)
                        .foregroundStyle(.red)
                        .lineLimit(1)
                }
            }

            Spacer()

            Image(systemName: action.status == .completed ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(action.status == .completed ? .green : .red)
        }
    }
}

#Preview {
    ActionsView()
        .environment(NetworkMonitor.shared)
        .environment(MemPalaceManager.shared)
        .environment(ModelDownloadManager.shared)
}
