import SwiftUI

// MARK: - Note Detail View

struct NoteDetailView: View {
    let note: Note
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Category badge + timestamp
                HStack {
                    Label(note.category.displayName, systemImage: note.category.icon)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(categoryColor.opacity(0.15), in: Capsule())
                        .foregroundStyle(categoryColor)

                    Spacer()

                    VStack(alignment: .trailing, spacing: 2) {
                        Text(note.timestamp, style: .date)
                            .font(.caption)
                        Text(note.timestamp, style: .time)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                // Content
                VStack(alignment: .leading, spacing: 8) {
                    Text("Content")
                        .font(.headline)
                    Text(note.content)
                        .font(.body)
                        .foregroundStyle(.primary)
                }

                // Raw transcription
                if note.rawTranscription != note.content {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Original Transcription")
                            .font(.headline)
                        Text(note.rawTranscription)
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .italic()
                    }
                }

                // Tags
                if !note.tags.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Tags")
                            .font(.headline)
                        FlowLayout(spacing: 6) {
                            ForEach(note.tags, id: \.self) { tag in
                                Text(tag)
                                    .font(.caption)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 5)
                                    .background(.quaternary, in: Capsule())
                            }
                        }
                    }
                }

                // Location context
                if let location = note.contextLocation, !location.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Location")
                            .font(.headline)
                        Label(location, systemImage: "location.fill")
                            .font(.body)
                            .foregroundStyle(.secondary)
                    }
                }

                // Sync status
                HStack {
                    Image(systemName: note.isSynced ? "checkmark.icloud" : "icloud.slash")
                        .foregroundStyle(note.isSynced ? .green : .orange)
                    Text(note.isSynced ? "Synced to cloud" : "Not yet synced")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 8)
            }
            .padding()
        }
        .navigationTitle("Note")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: note.content)
            }
        }
    }

    private var categoryColor: Color {
        switch note.category {
        case .note: return .blue
        case .task: return .green
        case .reminder: return .orange
        case .action: return .purple
        case .contact: return .pink
        case .idea: return .yellow
        case .query: return .teal
        }
    }
}

// MARK: - Flow Layout (for tags)

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var currentX: CGFloat = 0
        var currentY: CGFloat = 0
        var lineHeight: CGFloat = 0
        var totalHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)

            if currentX + size.width > maxWidth && currentX > 0 {
                currentX = 0
                currentY += lineHeight + spacing
                lineHeight = 0
            }

            positions.append(CGPoint(x: currentX, y: currentY))
            currentX += size.width + spacing
            lineHeight = max(lineHeight, size.height)
            totalHeight = max(totalHeight, currentY + lineHeight)
        }

        return (CGSize(width: maxWidth, height: totalHeight), positions)
    }
}
