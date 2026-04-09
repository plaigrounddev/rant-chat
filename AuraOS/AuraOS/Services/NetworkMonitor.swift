import Foundation
import Network
import Observation

// MARK: - Network Monitor

/// Monitors network connectivity using NWPathMonitor.
/// Publishes real-time online/offline status for SwiftUI binding.
@Observable
final class NetworkMonitor {

    // MARK: - Singleton

    static let shared = NetworkMonitor()

    // MARK: - Connection Type

    enum ConnectionType: String {
        case wifi = "Wi-Fi"
        case cellular = "Cellular"
        case wiredEthernet = "Ethernet"
        case none = "None"
    }

    // MARK: - State

    private(set) var isConnected: Bool = false
    private(set) var connectionType: ConnectionType = .none
    private(set) var isExpensive: Bool = false  // Cellular or personal hotspot

    /// Fires when transitioning from offline to online
    var onConnected: (() -> Void)?

    // MARK: - Private

    private let monitor = NWPathMonitor()
    private let monitorQueue = DispatchQueue(label: "dev.auraos.network", qos: .utility)
    private var wasConnected: Bool = false

    // MARK: - Init

    private init() {
        startMonitoring()
    }

    deinit {
        stopMonitoring()
    }

    // MARK: - Monitoring

    func startMonitoring() {
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }

            let connected = path.status == .satisfied
            let type: ConnectionType

            if path.usesInterfaceType(.wifi) {
                type = .wifi
            } else if path.usesInterfaceType(.cellular) {
                type = .cellular
            } else if path.usesInterfaceType(.wiredEthernet) {
                type = .wiredEthernet
            } else {
                type = .none
            }

            let expensive = path.isExpensive

            DispatchQueue.main.async {
                let wasOffline = !self.isConnected
                self.isConnected = connected
                self.connectionType = type
                self.isExpensive = expensive

                // Detect offline → online transition
                if connected && wasOffline && self.wasConnected {
                    self.onConnected?()
                    NotificationCenter.default.post(name: .auraNetworkConnected, object: nil)
                }

                self.wasConnected = true
            }
        }

        monitor.start(queue: monitorQueue)
    }

    func stopMonitoring() {
        monitor.cancel()
    }

    // MARK: - Status Display

    var statusText: String {
        if isConnected {
            return connectionType.rawValue
        }
        return "Offline"
    }

    var statusIcon: String {
        switch connectionType {
        case .wifi: return "wifi"
        case .cellular: return "antenna.radiowaves.left.and.right"
        case .wiredEthernet: return "cable.connector"
        case .none: return "wifi.slash"
        }
    }

    var statusColor: String {
        isConnected ? "green" : "red"
    }
}

// MARK: - Notification Names

extension Notification.Name {
    /// Posted when the device transitions from offline to online
    static let auraNetworkConnected = Notification.Name("auraNetworkConnected")
}
