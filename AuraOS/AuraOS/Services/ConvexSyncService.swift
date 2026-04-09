import Foundation
import Observation

// MARK: - Convex Sync Service

/// REST client for syncing local MemPalace data to Convex cloud backend.
/// Handles memory sync, note sync, and online action execution via Convex mutations/actions.
@Observable
final class ConvexSyncService {

    // MARK: - Singleton

    static let shared = ConvexSyncService()

    // MARK: - Configuration

    /// Convex deployment URL (set via Settings or environment)
    var convexURL: String {
        get { MemPalaceManager.shared.getSetting(key: "convex_url") ?? "" }
        set { MemPalaceManager.shared.setSetting(key: "convex_url", value: newValue) }
    }

    /// Convex deployment token for authentication (NOT the admin key)
    var convexToken: String {
        get { MemPalaceManager.shared.getSetting(key: "convex_token") ?? "" }
        set { MemPalaceManager.shared.setSetting(key: "convex_token", value: newValue) }
    }

    // MARK: - State

    private(set) var isSyncing: Bool = false
    private(set) var lastSyncDate: Date?
    private(set) var syncError: String?
    private(set) var pendingSyncCount: Int = 0

    /// Whether Convex sync is configured and ready
    var isConfigured: Bool {
        !convexURL.isEmpty && !convexToken.isEmpty
    }

    // MARK: - Init

    private init() {
        // Listen for network connectivity changes
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(onNetworkConnected),
            name: .auraNetworkConnected,
            object: nil
        )
    }

    @objc private func onNetworkConnected() {
        Task {
            await syncAll()
        }
    }

    // MARK: - Sync All

    /// Sync all unsynced data to Convex
    func syncAll() async {
        guard isConfigured, NetworkMonitor.shared.isConnected, !isSyncing else { return }

        isSyncing = true
        syncError = nil

        do {
            // 1. Sync memories
            try await syncMemories()

            // 2. Sync notes
            try await syncNotes()

            // 3. Flush action queue
            try await flushActionQueue()

            lastSyncDate = Date.now
            isSyncing = false
            updatePendingCount()

        } catch {
            syncError = error.localizedDescription
            isSyncing = false
        }
    }

    // MARK: - Memory Sync

    private func syncMemories() async throws {
        let unsynced = MemPalaceManager.shared.getUnsyncedMemories()
        guard !unsynced.isEmpty else { return }

        for memory in unsynced {
            let payload: [String: Any] = [
                "id": memory.id,
                "type": memory.type.rawValue,
                "content": memory.content,
                "tags": memory.tags,
                "timestamp": memory.timestamp.timeIntervalSince1970 * 1000,  // Convex uses ms
            ]

            try await callConvexMutation("aura:syncMemory", args: payload)
            MemPalaceManager.shared.markMemorySynced(id: memory.id)
        }
    }

    // MARK: - Note Sync

    private func syncNotes() async throws {
        let unsynced = MemPalaceManager.shared.getUnsyncedNotes()
        guard !unsynced.isEmpty else { return }

        for note in unsynced {
            let payload: [String: Any] = [
                "id": note.id,
                "category": note.category.rawValue,
                "rawTranscription": note.rawTranscription,
                "content": note.content,
                "tags": note.tags,
                "timestamp": note.timestamp.timeIntervalSince1970 * 1000,
                "contextLocation": note.contextLocation ?? "",
            ]

            try await callConvexMutation("aura:syncNote", args: payload)
            MemPalaceManager.shared.markNoteSynced(id: note.id)
        }
    }

    // MARK: - Action Queue Flush

    private func flushActionQueue() async throws {
        let pending = MemPalaceManager.shared.getPendingActions()
        guard !pending.isEmpty else { return }

        for action in pending {
            MemPalaceManager.shared.updateAction(id: action.id, status: .executing)

            do {
                let payload: [String: Any] = [
                    "id": action.id,
                    "type": action.type.rawValue,
                    "title": action.title,
                    "payload": action.payload,
                ]

                try await callConvexAction("aura:executeAction", args: payload)
                MemPalaceManager.shared.updateAction(id: action.id, status: .completed)
            } catch {
                MemPalaceManager.shared.updateAction(
                    id: action.id,
                    status: .failed,
                    error: error.localizedDescription
                )
            }
        }
    }

    // MARK: - Convex HTTP API

    /// Call a Convex mutation via the HTTP API
    private func callConvexMutation(_ path: String, args: [String: Any]) async throws {
        try await callConvex(endpoint: "mutation", path: path, args: args)
    }

    /// Call a Convex action via the HTTP API
    private func callConvexAction(_ path: String, args: [String: Any]) async throws {
        try await callConvex(endpoint: "action", path: path, args: args)
    }

    /// Call a Convex query via the HTTP API
    func callConvexQuery(_ path: String, args: [String: Any] = [:]) async throws -> Any? {
        return try await callConvex(endpoint: "query", path: path, args: args)
    }

    @discardableResult
    private func callConvex(endpoint: String, path: String, args: [String: Any]) async throws -> Any? {
        guard
            let baseURL = URL(string: convexURL),
            let url = URL(string: "api/\(endpoint)", relativeTo: baseURL)
        else {
            throw ConvexSyncError.notConfigured
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if !convexToken.isEmpty {
            request.setValue("Bearer \(convexToken)", forHTTPHeaderField: "Authorization")
        }

        let body: [String: Any] = [
            "path": path,
            "args": args,
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ConvexSyncError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let errorBody = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw ConvexSyncError.serverError(statusCode: httpResponse.statusCode, message: errorBody)
        }

        // Parse response
        let json = try JSONSerialization.jsonObject(with: data)
        if let dict = json as? [String: Any] {
            return dict["value"]
        }
        return json
    }

    // MARK: - Helpers

    private func updatePendingCount() {
        let memories = MemPalaceManager.shared.getUnsyncedMemories().count
        let notes = MemPalaceManager.shared.getUnsyncedNotes().count
        let actions = MemPalaceManager.shared.getPendingActions().count
        pendingSyncCount = memories + notes + actions
    }

    var lastSyncFormatted: String {
        guard let date = lastSyncDate else { return "Never" }
        return DateHelpers.formatRelativeDate(date)
    }
}

// MARK: - Errors

enum ConvexSyncError: Error, LocalizedError {
    case notConfigured
    case invalidResponse
    case serverError(statusCode: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Convex sync is not configured. Set the deployment URL and token in Settings."
        case .invalidResponse:
            return "Invalid response from Convex server"
        case .serverError(let code, let message):
            return "Convex server error (\(code)): \(message)"
        }
    }
}
