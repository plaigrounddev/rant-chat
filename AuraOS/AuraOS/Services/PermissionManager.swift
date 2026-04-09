import Foundation
import AVFoundation
import EventKit
import Contacts
import CoreLocation
import HealthKit
import Speech
import Observation

// MARK: - Permission Manager

/// Centralized permission checking and requesting for all iOS system capabilities.
@Observable
final class PermissionManager: NSObject {

    // MARK: - Singleton

    static let shared = PermissionManager()

    // MARK: - Permission Types

    enum PermissionType: String, CaseIterable, Identifiable {
        case microphone
        case camera
        case contacts
        case calendar
        case reminders
        case location
        case health
        case speechRecognition

        var id: String { rawValue }

        var displayName: String {
            switch self {
            case .microphone: return "Microphone"
            case .camera: return "Camera"
            case .contacts: return "Contacts"
            case .calendar: return "Calendar"
            case .reminders: return "Reminders"
            case .location: return "Location"
            case .health: return "Health"
            case .speechRecognition: return "Speech Recognition"
            }
        }

        var icon: String {
            switch self {
            case .microphone: return "mic.fill"
            case .camera: return "camera.fill"
            case .contacts: return "person.crop.circle.fill"
            case .calendar: return "calendar"
            case .reminders: return "bell.fill"
            case .location: return "location.fill"
            case .health: return "heart.fill"
            case .speechRecognition: return "waveform"
            }
        }

        var description: String {
            switch self {
            case .microphone: return "Voice recording for notes and commands"
            case .camera: return "Take photos via voice command"
            case .contacts: return "Look up and call contacts"
            case .calendar: return "Create and read calendar events"
            case .reminders: return "Create reminders from voice"
            case .location: return "Add location context to notes"
            case .health: return "Read and log health data"
            case .speechRecognition: return "On-device speech recognition"
            }
        }

        /// Whether this permission is required for core functionality
        var isRequired: Bool {
            switch self {
            case .microphone, .speechRecognition: return true
            default: return false
            }
        }
    }

    // MARK: - Permission Status

    enum PermissionStatus: String {
        case notDetermined
        case granted
        case denied
        case restricted
        case unknown

        var displayName: String {
            switch self {
            case .notDetermined: return "Not Asked"
            case .granted: return "Granted"
            case .denied: return "Denied"
            case .restricted: return "Restricted"
            case .unknown: return "Unknown"
            }
        }

        var color: String {
            switch self {
            case .granted: return "green"
            case .denied: return "red"
            case .restricted: return "orange"
            case .notDetermined: return "gray"
            case .unknown: return "gray"
            }
        }
    }

    // MARK: - State

    var permissionStatuses: [PermissionType: PermissionStatus] = [:]

    // MARK: - Private

    private let locationManager = CLLocationManager()
    private let eventStore = EKEventStore()
    private let healthStore = HKHealthStore()

    // MARK: - Init

    private override init() {
        super.init()
        refreshAllStatuses()
    }

    // MARK: - Check Status

    /// Check the current permission status for a given type
    func checkPermission(_ type: PermissionType) -> PermissionStatus {
        switch type {
        case .microphone:
            return checkMicrophoneStatus()
        case .camera:
            return checkCameraStatus()
        case .contacts:
            return checkContactsStatus()
        case .calendar:
            return checkCalendarStatus()
        case .reminders:
            return checkRemindersStatus()
        case .location:
            return checkLocationStatus()
        case .health:
            return .unknown  // HealthKit doesn't expose global status
        case .speechRecognition:
            return checkSpeechStatus()
        }
    }

    /// Refresh all permission statuses
    func refreshAllStatuses() {
        for type in PermissionType.allCases {
            permissionStatuses[type] = checkPermission(type)
        }
    }

    // MARK: - Request Permission

    /// Request a specific permission
    func requestPermission(_ type: PermissionType) async -> Bool {
        switch type {
        case .microphone:
            return await requestMicrophone()
        case .camera:
            return await requestCamera()
        case .contacts:
            return await requestContacts()
        case .calendar:
            return await requestCalendar()
        case .reminders:
            return await requestReminders()
        case .location:
            requestLocation()
            return true  // Location uses delegate, not async
        case .health:
            return await requestHealth()
        case .speechRecognition:
            return await requestSpeechRecognition()
        }
    }

    /// Request all required permissions in sequence
    func requestRequiredPermissions() async {
        for type in PermissionType.allCases where type.isRequired {
            _ = await requestPermission(type)
        }
        refreshAllStatuses()
    }

    /// Request all permissions in sequence
    func requestAllPermissions() async {
        for type in PermissionType.allCases {
            _ = await requestPermission(type)
        }
        refreshAllStatuses()
    }

    // MARK: - Individual Permission Checks

    private func checkMicrophoneStatus() -> PermissionStatus {
        switch AVAudioApplication.shared.recordPermission {
        case .undetermined: return .notDetermined
        case .denied: return .denied
        case .granted: return .granted
        @unknown default: return .unknown
        }
    }

    private func checkCameraStatus() -> PermissionStatus {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .notDetermined: return .notDetermined
        case .restricted: return .restricted
        case .denied: return .denied
        case .authorized: return .granted
        @unknown default: return .unknown
        }
    }

    private func checkContactsStatus() -> PermissionStatus {
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .notDetermined: return .notDetermined
        case .restricted: return .restricted
        case .denied: return .denied
        case .authorized: return .granted
        @unknown default: return .unknown
        }
    }

    private func checkCalendarStatus() -> PermissionStatus {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .notDetermined: return .notDetermined
        case .restricted: return .restricted
        case .denied: return .denied
        case .fullAccess, .writeOnly: return .granted
        @unknown default: return .unknown
        }
    }

    private func checkRemindersStatus() -> PermissionStatus {
        switch EKEventStore.authorizationStatus(for: .reminder) {
        case .notDetermined: return .notDetermined
        case .restricted: return .restricted
        case .denied: return .denied
        case .fullAccess, .writeOnly: return .granted
        @unknown default: return .unknown
        }
    }

    private func checkLocationStatus() -> PermissionStatus {
        switch locationManager.authorizationStatus {
        case .notDetermined: return .notDetermined
        case .restricted: return .restricted
        case .denied: return .denied
        case .authorizedWhenInUse, .authorizedAlways: return .granted
        @unknown default: return .unknown
        }
    }

    private func checkSpeechStatus() -> PermissionStatus {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        case .restricted: return .restricted
        case .authorized: return .granted
        @unknown default: return .unknown
        }
    }

    // MARK: - Individual Permission Requests

    private func requestMicrophone() async -> Bool {
        let granted = await AVAudioApplication.requestRecordPermission()
        permissionStatuses[.microphone] = granted ? .granted : .denied
        return granted
    }

    private func requestCamera() async -> Bool {
        let granted = await AVCaptureDevice.requestAccess(for: .video)
        permissionStatuses[.camera] = granted ? .granted : .denied
        return granted
    }

    private func requestContacts() async -> Bool {
        do {
            let granted = try await CNContactStore().requestAccess(for: .contacts)
            permissionStatuses[.contacts] = granted ? .granted : .denied
            return granted
        } catch {
            permissionStatuses[.contacts] = .denied
            return false
        }
    }

    private func requestCalendar() async -> Bool {
        do {
            let granted = try await eventStore.requestFullAccessToEvents()
            permissionStatuses[.calendar] = granted ? .granted : .denied
            return granted
        } catch {
            permissionStatuses[.calendar] = .denied
            return false
        }
    }

    private func requestReminders() async -> Bool {
        do {
            let granted = try await eventStore.requestFullAccessToReminders()
            permissionStatuses[.reminders] = granted ? .granted : .denied
            return granted
        } catch {
            permissionStatuses[.reminders] = .denied
            return false
        }
    }

    private func requestLocation() {
        locationManager.delegate = self
        locationManager.requestWhenInUseAuthorization()
    }

    private func requestHealth() async -> Bool {
        guard HKHealthStore.isHealthDataAvailable() else {
            return false
        }

        let readTypes: Set<HKObjectType> = [
            HKObjectType.quantityType(forIdentifier: .stepCount)!,
            HKObjectType.quantityType(forIdentifier: .heartRate)!,
            HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!,
        ]

        do {
            try await healthStore.requestAuthorization(toShare: [], read: readTypes)
            permissionStatuses[.health] = .granted
            return true
        } catch {
            permissionStatuses[.health] = .denied
            return false
        }
    }

    private func requestSpeechRecognition() async -> Bool {
        return await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                let granted = status == .authorized
                DispatchQueue.main.async {
                    self.permissionStatuses[.speechRecognition] = granted ? .granted : .denied
                }
                continuation.resume(returning: granted)
            }
        }
    }

    // MARK: - Helpers

    /// Check if all required permissions are granted
    var allRequiredPermissionsGranted: Bool {
        PermissionType.allCases
            .filter { $0.isRequired }
            .allSatisfy { permissionStatuses[$0] == .granted }
    }

    /// Open iOS Settings for this app
    @MainActor
    func openAppSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }
}

// MARK: - CLLocationManagerDelegate

extension PermissionManager: CLLocationManagerDelegate {
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        permissionStatuses[.location] = checkLocationStatus()
    }
}
