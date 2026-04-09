import Foundation
import Observation

// MARK: - Actions View Model

/// Manages the pending actions queue UI and execution.
@Observable
final class ActionsViewModel {

    // MARK: - State

    var pendingActions: [QueuedAction] = []
    var completedActions: [QueuedAction] = []
    var isExecuting: Bool = false

    // MARK: - Private

    private let actionManager = ActionQueueManager.shared

    // MARK: - Load

    func refresh() {
        actionManager.refreshActions()
        pendingActions = actionManager.pendingActions
        completedActions = actionManager.completedActions
        isExecuting = actionManager.isExecuting
    }

    // MARK: - Actions

    func confirmAction(id: String) async {
        isExecuting = true
        await actionManager.confirmAction(id: id)
        isExecuting = false
        refresh()
    }

    func skipAction(id: String) {
        actionManager.skipAction(id: id)
        refresh()
    }

    func deleteAction(id: String) {
        actionManager.deleteAction(id: id)
        refresh()
    }

    func flushAll() async {
        isExecuting = true
        await actionManager.flushQueue()
        isExecuting = false
        refresh()
    }

    // MARK: - Computed

    var hasPendingActions: Bool {
        !pendingActions.isEmpty
    }

    var pendingSummary: String {
        actionManager.pendingSummary
    }
}
