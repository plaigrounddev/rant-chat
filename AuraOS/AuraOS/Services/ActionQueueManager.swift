import Foundation
import Observation

// MARK: - Action Queue Manager

/// Manages the offline action queue — stores pending actions locally and
/// flushes them through Convex when internet is available.
@Observable
final class ActionQueueManager {

    // MARK: - Singleton

    static let shared = ActionQueueManager()

    // MARK: - State

    var pendingActions: [QueuedAction] = []
    var completedActions: [QueuedAction] = []
    var isExecuting: Bool = false
    var autoExecute: Bool {
        get { MemPalaceManager.shared.getSetting(key: "auto_execute_actions") == "true" }
        set { MemPalaceManager.shared.setSetting(key: "auto_execute_actions", value: newValue ? "true" : "false") }
    }

    // MARK: - Private

    private let memPalace = MemPalaceManager.shared
    private let convex = ConvexSyncService.shared
    private let network = NetworkMonitor.shared

    // MARK: - Init

    private init() {
        refreshActions()

        // Listen for network connectivity — auto-flush if enabled
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(onNetworkConnected),
            name: .auraNetworkConnected,
            object: nil
        )
    }

    @objc private func onNetworkConnected() {
        guard autoExecute else { return }
        Task {
            await flushQueue()
        }
    }

    // MARK: - Public API

    /// Refresh the action lists from the database
    func refreshActions() {
        pendingActions = memPalace.getPendingActions()
        completedActions = memPalace.getAllActions().filter {
            $0.status == .completed || $0.status == .failed
        }
    }

    /// Enqueue a new action
    func enqueue(
        type: OnlineActionType,
        title: String,
        payload: [String: String],
        requiresConfirmation: Bool = true
    ) {
        let payloadJSON = (try? JSONEncoder().encode(payload))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"

        memPalace.enqueueAction(
            type: type,
            title: title,
            payload: payloadJSON,
            requiresConfirmation: requiresConfirmation
        )
        refreshActions()
    }

    /// Confirm and execute a single action
    func confirmAction(id: String) async {
        guard let action = pendingActions.first(where: { $0.id == id }) else { return }
        guard network.isConnected else {
            // Can't execute offline — keep pending
            return
        }

        isExecuting = true
        memPalace.updateAction(id: id, status: .executing)
        refreshActions()

        do {
            try await convex.callConvexAction("aura:executeAction", args: [
                "id": action.id,
                "type": action.type.rawValue,
                "title": action.title,
                "payload": action.payload,
            ] as [String: Any])

            memPalace.updateAction(id: id, status: .completed)
        } catch {
            memPalace.updateAction(id: id, status: .failed, error: error.localizedDescription)
        }

        isExecuting = false
        refreshActions()
    }

    /// Skip (cancel) a pending action
    func skipAction(id: String) {
        memPalace.updateAction(id: id, status: .skipped)
        refreshActions()
    }

    /// Delete an action from history
    func deleteAction(id: String) {
        memPalace.deleteAction(id: id)
        refreshActions()
    }

    /// Flush all pending actions (execute via Convex)
    func flushQueue() async {
        guard network.isConnected, !isExecuting else { return }
        guard !pendingActions.isEmpty else { return }

        isExecuting = true

        for action in pendingActions {
            // Skip actions that require confirmation if not auto-execute
            if action.requiresConfirmation && !autoExecute {
                continue
            }

            memPalace.updateAction(id: action.id, status: .executing)

            do {
                if convex.isConfigured {
                    try await convex.callConvexAction("aura:executeAction", args: [
                        "id": action.id,
                        "type": action.type.rawValue,
                        "title": action.title,
                        "payload": action.payload,
                    ] as [String: Any])
                }
                memPalace.updateAction(id: action.id, status: .completed)
            } catch {
                memPalace.updateAction(id: action.id, status: .failed, error: error.localizedDescription)
            }
        }

        isExecuting = false
        refreshActions()
    }

    /// Get count of pending actions
    var pendingCount: Int {
        pendingActions.count
    }

    /// Summary text for the pending actions tray
    var pendingSummary: String {
        guard !pendingActions.isEmpty else {
            return "No pending actions"
        }

        let count = pendingActions.count
        let types = Set(pendingActions.map { $0.type.displayName })
        let typeList = types.joined(separator: ", ")

        return "\(count) pending action\(count == 1 ? "" : "s") (\(typeList))"
    }
}
