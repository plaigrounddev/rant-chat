import SwiftUI

// MARK: - Action Card

/// Displays a pending action with confirm/skip controls.
struct ActionCard: View {
    let action: QueuedAction
    let isOnline: Bool
    let isExecuting: Bool
    let onConfirm: () -> Void
    let onSkip: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                // Type icon
                Image(systemName: action.type.icon)
                    .font(.title2)
                    .foregroundStyle(.accentColor)
                    .frame(width: 36, height: 36)
                    .background(.accentColor.opacity(0.1), in: Circle())

                // Content
                VStack(alignment: .leading, spacing: 2) {
                    Text(action.title)
                        .font(.body)
                        .lineLimit(2)

                    HStack(spacing: 4) {
                        Text(action.type.displayName)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("•")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                        Text(DateHelpers.formatRelativeDate(action.createdAt))
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }

                Spacer()
            }

            // Action buttons
            if action.status == .pending {
                HStack(spacing: 12) {
                    Button {
                        onConfirm()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "play.fill")
                                .font(.caption)
                            Text("Execute")
                                .font(.caption)
                                .fontWeight(.medium)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(.accentColor, in: Capsule())
                        .foregroundStyle(.white)
                    }
                    .disabled(!isOnline || isExecuting)
                    .opacity(!isOnline ? 0.5 : 1.0)

                    Button {
                        onSkip()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "forward.fill")
                                .font(.caption)
                            Text("Skip")
                                .font(.caption)
                                .fontWeight(.medium)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color(.systemGray5), in: Capsule())
                        .foregroundStyle(.secondary)
                    }

                    Spacer()

                    if !isOnline {
                        Label("Offline", systemImage: "wifi.slash")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }
                }
            }

            if action.status == .executing {
                HStack(spacing: 8) {
                    ProgressView()
                        .scaleEffect(0.8)
                    Text("Executing...")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    List {
        ActionCard(
            action: QueuedAction(
                type: .sendEmail,
                title: "Send email to Rafael about the ISA portal update",
                payload: "{}"
            ),
            isOnline: true,
            isExecuting: false,
            onConfirm: {},
            onSkip: {}
        )

        ActionCard(
            action: QueuedAction(
                type: .postSlack,
                title: "Post to #general: standup notes from today",
                payload: "{}"
            ),
            isOnline: false,
            isExecuting: false,
            onConfirm: {},
            onSkip: {}
        )
    }
}
