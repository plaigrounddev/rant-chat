import SwiftUI

// MARK: - Content View (Main Tab Navigation)

struct ContentView: View {
    @State private var selectedTab: AppTab = .home
    @Environment(NetworkMonitor.self) private var networkMonitor

    var body: some View {
        TabView(selection: $selectedTab) {
            HomeView()
                .tabItem { Label("Home", systemImage: "waveform.circle.fill") }
                .tag(AppTab.home)

            NotesView()
                .tabItem { Label("Notes", systemImage: "note.text") }
                .tag(AppTab.notes)

            MemoryView()
                .tabItem { Label("Memory", systemImage: "brain.head.profile") }
                .tag(AppTab.memory)

            ActionsView()
                .tabItem { Label("Actions", systemImage: "bolt.fill") }
                .tag(AppTab.actions)

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
                .tag(AppTab.settings)
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
