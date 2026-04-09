import SwiftUI

@main
struct AuraOSApp: App {
    @State private var modelManager = ModelDownloadManager.shared
    @State private var memPalace = MemPalaceManager.shared
    @State private var networkMonitor = NetworkMonitor.shared

    var body: some Scene {
        WindowGroup {
            Group {
                if modelManager.isReady {
                    ContentView()
                } else {
                    OnboardingView()
                }
            }
            .environment(modelManager)
            .environment(memPalace)
            .environment(networkMonitor)
        }
    }
}
