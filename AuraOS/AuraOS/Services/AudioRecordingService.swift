import Foundation
import AVFoundation
import Observation

// MARK: - Audio Recording Service

/// Manages audio recording sessions using AVAudioRecorder.
/// Records to WAV format (16kHz mono) for whisper.cpp compatibility.
@Observable
final class AudioRecordingService: NSObject {

    // MARK: - State

    var isRecording: Bool = false
    var recordingDuration: TimeInterval = 0
    var audioLevel: Float = 0  // 0.0 to 1.0 normalized level for waveform
    var errorMessage: String?

    // MARK: - Private

    private var audioRecorder: AVAudioRecorder?
    private var levelTimer: Timer?
    private var durationTimer: Timer?
    private var currentRecordingURL: URL?

    // MARK: - Audio Settings

    /// Recording settings optimized for whisper.cpp (16kHz mono WAV)
    private let recordingSettings: [String: Any] = [
        AVFormatIDKey: Int(kAudioFormatLinearPCM),
        AVSampleRateKey: 16000.0,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
    ]

    // MARK: - Session Setup

    /// Configure the audio session for recording
    func setupAudioSession() async throws {
        let session = AVAudioSession.sharedInstance()

        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
        } catch {
            errorMessage = "Failed to configure audio session: \(error.localizedDescription)"
            throw AudioError.sessionSetupFailed(error)
        }
    }

    // MARK: - Recording

    /// Start recording audio to a temporary WAV file
    func startRecording() async throws -> URL {
        // Check microphone permission
        let permissionGranted = await AVAudioApplication.requestRecordPermission()
        guard permissionGranted else {
            errorMessage = "Microphone permission denied"
            throw AudioError.permissionDenied
        }

        // Set up audio session
        try await setupAudioSession()

        // Create temporary file URL
        let fileName = "aura_recording_\(Date.now.timeIntervalSince1970).wav"
        let tempDir = FileManager.default.temporaryDirectory
        let fileURL = tempDir.appendingPathComponent(fileName)

        do {
            audioRecorder = try AVAudioRecorder(url: fileURL, settings: recordingSettings)
            audioRecorder?.delegate = self
            audioRecorder?.isMeteringEnabled = true
            audioRecorder?.prepareToRecord()

            guard audioRecorder?.record() == true else {
                throw AudioError.recordingFailed
            }

            currentRecordingURL = fileURL
            isRecording = true
            recordingDuration = 0
            errorMessage = nil

            // Start level metering timer
            startMetering()
            startDurationTimer()

            return fileURL

        } catch {
            errorMessage = "Recording failed: \(error.localizedDescription)"
            throw AudioError.recordingFailed
        }
    }

    /// Stop recording and return the audio file URL
    func stopRecording() -> URL? {
        guard isRecording, let recorder = audioRecorder else { return nil }

        recorder.stop()
        isRecording = false
        stopMetering()
        stopDurationTimer()

        // Deactivate audio session
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        return currentRecordingURL
    }

    /// Cancel recording and delete the file
    func cancelRecording() {
        guard isRecording else { return }

        audioRecorder?.stop()
        audioRecorder?.deleteRecording()
        isRecording = false
        stopMetering()
        stopDurationTimer()
        currentRecordingURL = nil

        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: - Level Metering

    private func startMetering() {
        levelTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            guard let self, let recorder = self.audioRecorder, recorder.isRecording else { return }
            recorder.updateMeters()

            // Convert dB level to 0.0-1.0 range
            let averagePower = recorder.averagePower(forChannel: 0)
            // dB range: -160 (silent) to 0 (max)
            // Normalize to useful range: -50 to 0
            let normalizedLevel = max(0, (averagePower + 50) / 50)
            self.audioLevel = min(1.0, normalizedLevel)
        }
    }

    private func stopMetering() {
        levelTimer?.invalidate()
        levelTimer = nil
        audioLevel = 0
    }

    private func startDurationTimer() {
        durationTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self, self.isRecording else { return }
            self.recordingDuration = self.audioRecorder?.currentTime ?? 0
        }
    }

    private func stopDurationTimer() {
        durationTimer?.invalidate()
        durationTimer = nil
    }

    // MARK: - Utilities

    /// Format recording duration as MM:SS
    var formattedDuration: String {
        let minutes = Int(recordingDuration) / 60
        let seconds = Int(recordingDuration) % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }

    /// Clean up old temporary recordings
    func cleanupTempFiles() {
        let tempDir = FileManager.default.temporaryDirectory
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: tempDir,
            includingPropertiesForKeys: nil
        ) else { return }

        for file in files where file.lastPathComponent.hasPrefix("aura_recording_") {
            try? FileManager.default.removeItem(at: file)
        }
    }
}

// MARK: - AVAudioRecorderDelegate

extension AudioRecordingService: AVAudioRecorderDelegate {
    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        if !flag {
            errorMessage = "Recording finished unsuccessfully"
        }
        isRecording = false
        stopMetering()
        stopDurationTimer()
    }

    func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        errorMessage = "Recording encode error: \(error?.localizedDescription ?? "unknown")"
        isRecording = false
        stopMetering()
        stopDurationTimer()
    }
}

// MARK: - Errors

enum AudioError: Error, LocalizedError {
    case permissionDenied
    case sessionSetupFailed(Error)
    case recordingFailed
    case noRecording

    var errorDescription: String? {
        switch self {
        case .permissionDenied:
            return "Microphone permission is required for voice recording"
        case .sessionSetupFailed(let error):
            return "Audio session setup failed: \(error.localizedDescription)"
        case .recordingFailed:
            return "Failed to start recording"
        case .noRecording:
            return "No recording available"
        }
    }
}
