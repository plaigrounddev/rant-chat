import Foundation
import Observation

// MARK: - Voice Capture Pipeline

/// Orchestrates the full voice-to-action flow:
/// Record → Transcribe → Parse Intent → Route to Handler
///
/// All processing happens on-device with zero internet dependency.
@Observable
final class VoiceCapturePipeline {

    // MARK: - Singleton

    static let shared = VoiceCapturePipeline()

    // MARK: - State

    enum PipelineState: Equatable {
        case idle
        case recording
        case transcribing
        case parsing
        case executing(String)  // Description of what's being executed
        case completed(String)  // Result message
        case error(String)      // Error message
    }

    var state: PipelineState = .idle

    /// The most recent transcription
    var lastTranscription: String?

    /// The most recent parsed intent
    var lastIntent: ParsedIntent?

    /// The most recent execution result
    var lastResult: String?

    // MARK: - Services

    private let recorder = AudioRecordingService()
    private let whisper = WhisperService.shared
    private let intentParser = IntentParser.shared
    private let memPalace = MemPalaceManager.shared

    // MARK: - Public Properties (from recorder)

    var isRecording: Bool { recorder.isRecording }
    var audioLevel: Float { recorder.audioLevel }
    var recordingDuration: TimeInterval { recorder.recordingDuration }
    var formattedDuration: String { recorder.formattedDuration }

    // MARK: - Init

    private init() {}

    // MARK: - Public API

    /// Start the voice capture pipeline (tap-to-record)
    func startCapture() async {
        do {
            state = .recording
            _ = try await recorder.startRecording()
        } catch {
            state = .error("Recording failed: \(error.localizedDescription)")
        }
    }

    /// Stop recording and process the audio through the full pipeline
    func stopAndProcess() async {
        guard let audioURL = recorder.stopRecording() else {
            state = .error("No recording to process")
            return
        }

        // Step 1: Transcribe
        state = .transcribing
        do {
            let transcription = try await whisper.transcribe(audioURL: audioURL)
            lastTranscription = transcription

            guard !transcription.isEmpty else {
                state = .error("Could not detect any speech")
                cleanupAudioFile(audioURL)
                return
            }

            // Step 2: Parse intent
            state = .parsing
            let intent = await intentParser.parse(transcription: transcription)
            lastIntent = intent

            // Step 3: Route to handler
            let result = await routeIntent(intent, transcription: transcription)
            lastResult = result
            state = .completed(result)

        } catch {
            state = .error("Processing failed: \(error.localizedDescription)")
        }

        // Cleanup temp audio file
        cleanupAudioFile(audioURL)
    }

    /// Cancel current recording
    func cancelCapture() {
        recorder.cancelRecording()
        state = .idle
    }

    /// Reset pipeline state to idle
    func reset() {
        state = .idle
        lastTranscription = nil
        lastIntent = nil
        lastResult = nil
    }

    // MARK: - Intent Routing

    /// Route a parsed intent to the appropriate handler
    private func routeIntent(_ intent: ParsedIntent, transcription: String) async -> String {
        // Check if this is a system command
        if intent.command != .none {
            state = .executing("Executing: \(intent.command.displayName)")
            let result = await SystemControlService.shared.execute(
                command: intent.command,
                entities: intent.entities
            )
            // Also save to memory for context
            await memPalace.remember(
                content: "Executed command: \(intent.command.displayName). User said: \"\(transcription)\"",
                type: .episodic,
                tags: ["command", intent.command.rawValue]
            )
            return result
        }

        // Route by category
        switch intent.category {
        case .note:
            return await handleNote(transcription: transcription, intent: intent)
        case .task:
            return await handleTask(transcription: transcription, intent: intent)
        case .reminder:
            return await handleReminder(transcription: transcription, intent: intent)
        case .action:
            return await handleAction(transcription: transcription, intent: intent)
        case .contact:
            return await handleContact(transcription: transcription, intent: intent)
        case .idea:
            return await handleIdea(transcription: transcription, intent: intent)
        case .query:
            return await handleQuery(transcription: transcription, intent: intent)
        }
    }

    // MARK: - Category Handlers

    private func handleNote(transcription: String, intent: ParsedIntent) async -> String {
        let content = intent.entities.noteContent ?? transcription
        await memPalace.addNote(
            rawTranscription: transcription,
            content: content,
            category: .note,
            tags: ["voice_capture"]
        )
        return "📝 Note saved"
    }

    private func handleTask(transcription: String, intent: ParsedIntent) async -> String {
        let content = intent.entities.noteContent ?? transcription
        await memPalace.addNote(
            rawTranscription: transcription,
            content: content,
            category: .task,
            tags: ["task", "voice_capture"]
        )

        // If there's a date/time, also try to create a calendar event
        if let dateTime = intent.entities.dateTime {
            let result = await SystemControlService.shared.execute(
                command: .createEvent,
                entities: intent.entities
            )
            return "✅ Task saved & calendar event created (\(dateTime))"
        }

        return "✅ Task saved"
    }

    private func handleReminder(transcription: String, intent: ParsedIntent) async -> String {
        await memPalace.addNote(
            rawTranscription: transcription,
            content: intent.entities.reminderText ?? transcription,
            category: .reminder,
            tags: ["reminder", "voice_capture"]
        )

        // Create an actual iOS reminder
        let result = await SystemControlService.shared.execute(
            command: .setReminder,
            entities: intent.entities
        )

        return "🔔 \(result)"
    }

    private func handleAction(transcription: String, intent: ParsedIntent) async -> String {
        // Queue for online execution
        let content = intent.entities.noteContent ?? transcription

        // Determine action type from content
        let actionType: OnlineActionType
        let lower = transcription.lowercased()
        if lower.contains("email") {
            actionType = .sendEmail
        } else if lower.contains("slack") {
            actionType = .postSlack
        } else if lower.contains("message") || lower.contains("text") {
            actionType = .sendMessage
        } else if lower.contains("calendar") || lower.contains("schedule") {
            actionType = .createCalendarEvent
        } else {
            actionType = .custom
        }

        // Encode payload
        let payload: [String: String] = [
            "raw_transcription": transcription,
            "content": content,
            "contact_name": intent.entities.contactName ?? "",
            "date_time": intent.entities.dateTime ?? "",
        ]
        let payloadJSON = (try? JSONEncoder().encode(payload))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"

        memPalace.enqueueAction(
            type: actionType,
            title: content,
            payload: payloadJSON
        )

        let onlineStatus = NetworkMonitor.shared.isConnected
            ? "Will execute shortly"
            : "Queued for when you're online"
        return "⚡ Action queued: \(actionType.displayName). \(onlineStatus)"
    }

    private func handleContact(transcription: String, intent: ParsedIntent) async -> String {
        let contactName = intent.entities.contactName ?? transcription
        await memPalace.addNote(
            rawTranscription: transcription,
            content: contactName,
            category: .contact,
            tags: ["contact", "voice_capture"]
        )
        return "👤 Contact note saved: \(contactName)"
    }

    private func handleIdea(transcription: String, intent: ParsedIntent) async -> String {
        let content = intent.entities.noteContent ?? transcription
        await memPalace.addNote(
            rawTranscription: transcription,
            content: content,
            category: .idea,
            tags: ["idea", "voice_capture"]
        )
        return "💡 Idea captured"
    }

    private func handleQuery(transcription: String, intent: ParsedIntent) async -> String {
        let query = intent.entities.searchQuery ?? transcription

        // Search MemPalace for relevant information
        let memories = await memPalace.recall(query: query, limit: 3)

        if memories.isEmpty {
            // No relevant memories found — save the query and try LLM
            await memPalace.addNote(
                rawTranscription: transcription,
                content: query,
                category: .query,
                tags: ["query", "unanswered"]
            )

            // Try to answer with Gemma 4
            if LLMService.shared.isLoaded {
                let answer = await LLMService.shared.generateSync(
                    prompt: "Answer this question concisely: \(query)",
                    maxTokens: 256,
                    temperature: 0.5
                )
                if !answer.isEmpty {
                    return "🧠 \(answer)"
                }
            }

            return "🔍 No relevant memories found for: \"\(query)\". Saved for later."
        }

        // Format memory results
        let results = memories.prefix(3).map { "• \($0.content)" }.joined(separator: "\n")
        return "🧠 Here's what I remember:\n\(results)"
    }

    // MARK: - Helpers

    private func cleanupAudioFile(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
    }
}
