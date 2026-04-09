import SwiftUI

// MARK: - Memory Card

/// Displays a memory entry with type badge, content, and metadata.
struct MemoryCard: View {
    let memory: Memory

    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header: type badge + timestamp
            HStack {
                Label(memory.type.displayName, systemImage: memory.type.icon)
                    .font(.caption)
                    .fontWeight(.medium)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(typeColor.opacity(0.15), in: Capsule())
                    .foregroundStyle(typeColor)

                Spacer()

                Text(DateHelpers.formatRelativeDate(memory.timestamp))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            // Content
            Text(memory.content)
                .font(.body)
                .lineLimit(isExpanded ? nil : 3)
                .foregroundStyle(.primary)
                .onTapGesture {
                    withAnimation(.spring(duration: 0.2)) {
                        isExpanded.toggle()
                    }
                }

            // Tags
            if !memory.tags.isEmpty {
                HStack(spacing: 4) {
                    ForEach(memory.tags.prefix(5), id: \.self) { tag in
                        Text(tag)
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.quaternary, in: Capsule())
                    }

                    if memory.tags.count > 5 {
                        Text("+\(memory.tags.count - 5)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            // Sync status
            HStack(spacing: 4) {
                Image(systemName: memory.isSynced ? "checkmark.icloud" : "icloud.slash")
                    .font(.caption2)
                    .foregroundStyle(memory.isSynced ? .green : .orange)

                if memory.embedding != nil {
                    Image(systemName: "brain")
                        .font(.caption2)
                        .foregroundStyle(.purple)
                    Text("Embedded")
                        .font(.caption2)
                        .foregroundStyle(.purple)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var typeColor: Color {
        switch memory.type {
        case .episodic: return .blue
        case .semantic: return .purple
        case .procedural: return .green
        }
    }
}

#Preview {
    List {
        MemoryCard(memory: Memory(
            type: .semantic,
            content: "The user prefers bullet-point responses over long paragraphs. They work at a tech startup and are building an AI product.",
            tags: ["preference", "work", "ai"]
        ))

        MemoryCard(memory: Memory(
            type: .episodic,
            content: "Had a call with Brian about the ISA portal. Need to follow up on the authentication flow.",
            tags: ["brian", "isa-portal", "call"]
        ))

        MemoryCard(memory: Memory(
            type: .procedural,
            content: "User always records notes after calls with Brian.",
            tags: ["habit", "brian"]
        ))
    }
}
