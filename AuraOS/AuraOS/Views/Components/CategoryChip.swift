import SwiftUI

// MARK: - Category Chip

/// Tappable filter chip for note categories and memory types.
struct CategoryChip: View {
    let title: String
    let icon: String
    let isSelected: Bool
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.caption2)
                Text(title)
                    .font(.caption)
                    .fontWeight(.medium)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(
                isSelected ? color.opacity(0.2) : Color(.systemGray6),
                in: Capsule()
            )
            .foregroundStyle(isSelected ? color : .secondary)
            .overlay(
                Capsule()
                    .stroke(isSelected ? color.opacity(0.5) : Color.clear, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: isSelected)
    }
}

#Preview {
    HStack(spacing: 8) {
        CategoryChip(title: "All", icon: "tray.full", isSelected: true, color: .blue, action: {})
        CategoryChip(title: "Notes", icon: "note.text", isSelected: false, color: .blue, action: {})
        CategoryChip(title: "Tasks", icon: "checkmark.circle", isSelected: false, color: .green, action: {})
        CategoryChip(title: "Ideas", icon: "lightbulb.fill", isSelected: false, color: .yellow, action: {})
    }
}
