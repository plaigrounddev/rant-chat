import SwiftUI

// MARK: - Status Badge

/// Online/offline indicator with connection type.
struct StatusBadge: View {
    let isOnline: Bool
    let connectionType: String

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(isOnline ? .green : .red)
                .frame(width: 8, height: 8)

            Text(connectionType)
                .font(.caption2)
                .fontWeight(.medium)
                .foregroundStyle(isOnline ? .green : .red)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(
            (isOnline ? Color.green : Color.red).opacity(0.1),
            in: Capsule()
        )
    }
}

#Preview {
    VStack(spacing: 12) {
        StatusBadge(isOnline: true, connectionType: "Wi-Fi")
        StatusBadge(isOnline: true, connectionType: "Cellular")
        StatusBadge(isOnline: false, connectionType: "Offline")
    }
}
