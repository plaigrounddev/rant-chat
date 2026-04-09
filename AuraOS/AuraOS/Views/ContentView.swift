import SwiftUI

// MARK: - Content View (Main Tab Navigation)

struct ContentView: View {
    @State private var selectedTab: AppTab = .home
    @Environment(NetworkMonitor.self) private var networkMonitor

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Home", systemImage: "waveform.circle.fill", value: .home) {
                HomeView()
            }

            Tab("Notes", systemImage: "note.text", value: .notes) {
                NotesView()
            }

            Tab("Memory", systemImage: "brain.head.profile", value: .memory) {
                MemoryView()
            }

            Tab("Actions", systemImage: "bolt.fill", value: .actions) {
                ActionsView()
            }

            Tab("Settings", systemImage: "gearshape.fill", value: .settings) {
                SettingsView()
            }
        }
        .tint(.accentColor)
    }
}

// MARK: - Tab Enum

enum AppTab: String, CaseIterable {
    case home
    case notes
    case memory
    case actions
    case settings
}

#Preview {
    ContentView()
        .environment(NetworkMonitor.shared)
        .environment(MemPalaceManager.shared)
        .environment(ModelDownloadManager.shared)
}
