import Foundation
import Observation
import whisper

// MARK: - Whisper Transcription Service

/// On-device speech-to-text transcription using whisper.cpp.
/// Runs entirely offline — no data leaves the device.
@Observable
final class WhisperService {

    // MARK: - Singleton

    static let shared = WhisperService()

    // MARK: - State

    private(set) var isLoaded: Bool = false
    private(set) var isTranscribing: Bool = false
    var transcriptionProgress: Double = 0  // 0.0 to 1.0

    // MARK: - Private

    private var whisperContext: OpaquePointer?  // whisper_context *
    private let transcriptionQueue = DispatchQueue(label: "dev.auraos.whisper", qos: .userInitiated)

    // MARK: - Init

    private init() {}

    deinit {
        unloadModel()
    }

    // MARK: - Model Management

    /// Load the Whisper model from the given file path
    func loadModel(path: String) async throws {
        guard !isLoaded else { return }

        return try await withCheckedThrowingContinuation { continuation in
            transcriptionQueue.async { [weak self] in
                guard let self else {
                    continuation.resume(throwing: WhisperError.serviceUnavailable)
                    return
                }

                var params = whisper_context_default_params()
                params.use_gpu = true  // Use Metal acceleration if available

                guard let ctx = whisper_init_from_file_with_params(path, params) else {
                    continuation.resume(throwing: WhisperError.modelLoadFailed(path: path))
                    return
                }

                self.whisperContext = ctx

                DispatchQueue.main.async {
                    self.isLoaded = true
                }

                continuation.resume()
            }
        }
    }

    /// Unload the current model and free resources
    func unloadModel() {
        if let whisperContext {
            whisper_free(whisperContext)
        }
        self.whisperContext = nil
        isLoaded = false
    }

    // MARK: - Transcription

    /// Transcribe an audio file to text
    /// - Parameter audioURL: Path to a WAV file (16kHz mono recommended)
    /// - Returns: Transcribed text
    func transcribe(audioURL: URL) async throws -> String {
        guard let whisperContext else {
            throw WhisperError.modelNotLoaded
        }

        return try await withCheckedThrowingContinuation { continuation in
            transcriptionQueue.async { [weak self] in
                guard let self else {
                    continuation.resume(throwing: WhisperError.serviceUnavailable)
                    return
                }

                DispatchQueue.main.async {
                    self.isTranscribing = true
                    self.transcriptionProgress = 0
                }

                do {
                    // Read audio samples from WAV file
                    let samples = try self.readAudioSamples(from: audioURL)

                    guard !samples.isEmpty else {
                        throw WhisperError.emptyAudio
                    }

                    // Configure whisper parameters
                    var params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)
                    params.print_realtime = false
                    params.print_progress = false
                    params.print_timestamps = false
                    params.print_special = false
                    params.translate = false
                    params.language = "en".withCString { strdup($0) }
                    params.n_threads = Int32(min(ProcessInfo.processInfo.activeProcessorCount, 4))
                    params.no_timestamps = true
                    params.single_segment = false

                    // Run transcription
                    let result = samples.withUnsafeBufferPointer { buffer in
                        whisper_full(whisperContext, params, buffer.baseAddress!, Int32(samples.count))
                    }

                    free(UnsafeMutablePointer(mutating: params.language))

                    guard result == 0 else {
                        throw WhisperError.transcriptionFailed
                    }

                    // Collect transcribed text from all segments
                    let segmentCount = whisper_full_n_segments(whisperContext)
                    var fullText = ""

                    for i in 0..<segmentCount {
                        if let segmentText = whisper_full_get_segment_text(whisperContext, i) {
                            fullText += String(cString: segmentText)
                        }
                    }

                    let trimmedText = fullText.trimmingCharacters(in: .whitespacesAndNewlines)

                    DispatchQueue.main.async {
                        self.isTranscribing = false
                        self.transcriptionProgress = 1.0
                    }

                    continuation.resume(returning: trimmedText)

                } catch {
                    DispatchQueue.main.async {
                        self.isTranscribing = false
                        self.transcriptionProgress = 0
                    }
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    // MARK: - Audio Processing

    /// Read 16-bit PCM WAV file and convert to float samples
    private func readAudioSamples(from url: URL) throws -> [Float] {
        let data = try Data(contentsOf: url)

        // Parse WAV header (44 bytes for standard WAV)
        guard data.count > 44 else {
            throw WhisperError.invalidAudioFormat
        }

        // Verify WAV header
        let riffHeader = String(data: data[0..<4], encoding: .ascii)
        guard riffHeader == "RIFF" else {
            throw WhisperError.invalidAudioFormat
        }

        let waveHeader = String(data: data[8..<12], encoding: .ascii)
        guard waveHeader == "WAVE" else {
            throw WhisperError.invalidAudioFormat
        }

        // Find the data chunk
        var offset = 12
        var dataStart = 44  // Default
        var dataSize = data.count - 44

        while offset + 8 <= data.count {
            let chunkID = String(data: data[offset..<offset+4], encoding: .ascii) ?? ""
            let chunkSize = data.withUnsafeBytes { bytes in
                bytes.load(fromByteOffset: offset + 4, as: UInt32.self)
            }

            // Validate chunkSize won't overflow or exceed buffer
            let chunkSizeInt = Int(chunkSize)
            guard chunkSizeInt >= 0, offset + 8 + chunkSizeInt <= data.count else {
                throw WhisperError.invalidAudioFormat
            }

            if chunkID == "data" {
                dataStart = offset + 8
                dataSize = chunkSizeInt
                break
            }

            offset += 8 + chunkSizeInt
        }

        // Validate bounds before accessing sample buffer
        guard dataStart >= 0,
              dataSize >= 0,
              dataStart + dataSize <= data.count else {
            throw WhisperError.invalidAudioFormat
        }

        // Convert 16-bit PCM samples to float
        let sampleCount = dataSize / 2  // 16-bit = 2 bytes per sample
        guard sampleCount > 0, sampleCount <= 100_000_000 else {
            throw WhisperError.invalidAudioFormat
        }

        var samples = [Float](repeating: 0, count: sampleCount)

        data.withUnsafeBytes { rawBuffer in
            guard let base = rawBuffer.baseAddress else { return }
            let int16Buffer = base.advanced(by: dataStart)
                .assumingMemoryBound(to: Int16.self)

            for i in 0..<sampleCount {
                samples[i] = Float(int16Buffer[i]) / 32768.0
            }
        }

        return samples
    }

    // MARK: - Model Path

    /// Get the path where the Whisper model should be stored
    static var whisperModelPath: URL {
        LLMService.modelsDirectory.appendingPathComponent("ggml-small.en.bin")
    }

    static var isWhisperModelDownloaded: Bool {
        FileManager.default.fileExists(atPath: whisperModelPath.path)
    }
}

// MARK: - Errors

enum WhisperError: Error, LocalizedError {
    case modelLoadFailed(path: String)
    case modelNotLoaded
    case serviceUnavailable
    case transcriptionFailed
    case emptyAudio
    case invalidAudioFormat

    var errorDescription: String? {
        switch self {
        case .modelLoadFailed(let path):
            return "Failed to load Whisper model at: \(path)"
        case .modelNotLoaded:
            return "Whisper model is not loaded"
        case .serviceUnavailable:
            return "Whisper service is not available"
        case .transcriptionFailed:
            return "Audio transcription failed"
        case .emptyAudio:
            return "Audio file contains no audio data"
        case .invalidAudioFormat:
            return "Invalid audio file format (expected 16-bit PCM WAV)"
        }
    }
}
