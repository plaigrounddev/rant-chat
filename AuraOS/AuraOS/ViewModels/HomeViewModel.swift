import Foundation
import Observation

// MARK: - Home View Model

/// Manages recording state, transcription pipeline, and home screen state.
@Observable
final class HomeViewModel {

    // MARK: - State

    let pipeline = VoiceCapturePipeline.shared
    var stats = AuraStats()

    // MARK: - Init

    init() {
        refreshStats()
    }

    // MARK: - Recording

    /// Toggle recording on/off
    func toggleRecording() async {
        if pipeline.isRecording {
            await pipeline.stopAndProcess()
            refreshStats()
        } else {
            await pipeline.startCapture()
        }
    }

    /// Cancel current recording
    func cancelRecording() {
        pipeline.cancelCapture()
    }

    /// Reset pipeline state
    func reset() {
        pipeline.reset()
    }

    // MARK: - Stats

    func refreshStats() {
        stats = MemPalaceManager.shared.getStats()
    }

    // MARK: - Model Loading

    /// Load AI models on app startup
    func loadModels() async {
        // Load Gemma 4
        if LLMService.isGemmaModelDownloaded && !LLMService.shared.isLoaded {
            do {
                try await LLMService.shared.loadModel(path: LLMService.gemmaModelPath.path)
                print("[HomeVM] Gemma 4 model loaded successfully")
            } catch {
                print("[HomeVM] Failed to load Gemma 4: \(error)")
            }
        }

        // Load Whisper
        if WhisperService.isWhisperModelDownloaded && !WhisperService.shared.isLoaded {
            do {
                try await WhisperService.shared.loadModel(path: WhisperService.whisperModelPath.path)
                print("[HomeVM] Whisper model loaded successfully")
            } catch {
                print("[HomeVM] Failed to load Whisper: \(error)")
            }
        }
    }
}
