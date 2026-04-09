import Foundation
import AVFoundation
import EventKit
import Contacts
import UIKit

// MARK: - System Control Service

/// Maps parsed intents to iOS system API calls.
/// Handles flashlight, reminders, calendar events, phone calls, DND, camera, brightness, and more.
final class SystemControlService {

    // MARK: - Singleton

    static let shared = SystemControlService()

    // MARK: - Private

    private let eventStore = EKEventStore()

    // MARK: - Init

    private init() {}

    // MARK: - Execute Command

    /// Execute a system command with the given entities
    @MainActor
    func execute(command: SystemCommand, entities: ParsedIntent.IntentEntities) async -> String {
        switch command {
        case .flashlightOn:
            return toggleFlashlight(on: true)
        case .flashlightOff:
            return toggleFlashlight(on: false)
        case .setReminder:
            return await createReminder(
                text: entities.reminderText ?? "Reminder",
                dateTimeString: entities.dateTime
            )
        case .createEvent:
            return await createCalendarEvent(
                title: entities.eventTitle ?? "Event",
                dateTimeString: entities.dateTime
            )
        case .readCalendar:
            return await readTodayCalendar()
        case .makeCall:
            return makePhoneCall(contactName: entities.contactName)
        case .toggleDND:
            return toggleDoNotDisturb()
        case .takePhoto:
            return openCamera()
        case .setBrightness:
            return setBrightness(level: entities.brightnessLevel)
        case .setVolume:
            return "Volume control requires system-level access. Use the physical volume buttons."
        case .openURL:
            return await openURL(entities.url)
        case .searchContacts:
            return await searchContacts(name: entities.contactName ?? entities.searchQuery ?? "")
        case .none:
            return "No system command to execute"
        }
    }

    // MARK: - Flashlight

    private func toggleFlashlight(on: Bool) -> String {
        guard let device = AVCaptureDevice.default(for: .video), device.hasTorch else {
            return "❌ Flashlight not available on this device"
        }

        do {
            try device.lockForConfiguration()
            device.torchMode = on ? .on : .off
            if on {
                try device.setTorchModeOn(level: AVCaptureDevice.maxAvailableTorchLevel)
            }
            device.unlockForConfiguration()
            return on ? "🔦 Flashlight on" : "🔦 Flashlight off"
        } catch {
            return "❌ Failed to toggle flashlight: \(error.localizedDescription)"
        }
    }

    // MARK: - Reminders (EventKit)

    private func createReminder(text: String, dateTimeString: String?) async -> String {
        // Request access
        do {
            let granted = try await eventStore.requestFullAccessToReminders()
            guard granted else {
                return "❌ Reminders access denied. Please enable in Settings."
            }
        } catch {
            return "❌ Failed to access reminders: \(error.localizedDescription)"
        }

        let reminder = EKReminder(eventStore: eventStore)
        reminder.title = text
        reminder.calendar = eventStore.defaultCalendarForNewReminders()

        // Parse date/time if provided
        if let dateTimeString {
            let parsedDate = DateHelpers.parseNaturalLanguageDate(dateTimeString)
            if let date = parsedDate {
                let alarm = EKAlarm(absoluteDate: date)
                reminder.addAlarm(alarm)
                reminder.dueDateComponents = Calendar.current.dateComponents(
                    [.year, .month, .day, .hour, .minute],
                    from: date
                )
            }
        }

        do {
            try eventStore.save(reminder, commit: true)
            let dateInfo = dateTimeString.map { " for \($0)" } ?? ""
            return "Reminder set: \"\(text)\"\(dateInfo)"
        } catch {
            return "❌ Failed to create reminder: \(error.localizedDescription)"
        }
    }

    // MARK: - Calendar Events (EventKit)

    private func createCalendarEvent(title: String, dateTimeString: String?) async -> String {
        // Request access
        do {
            let granted = try await eventStore.requestFullAccessToEvents()
            guard granted else {
                return "❌ Calendar access denied. Please enable in Settings."
            }
        } catch {
            return "❌ Failed to access calendar: \(error.localizedDescription)"
        }

        let event = EKEvent(eventStore: eventStore)
        event.title = title
        event.calendar = eventStore.defaultCalendarForNewEvents

        // Parse date/time
        if let dateTimeString, let date = DateHelpers.parseNaturalLanguageDate(dateTimeString) {
            event.startDate = date
            event.endDate = date.addingTimeInterval(3600)  // 1 hour default duration
        } else {
            // Default to 1 hour from now
            event.startDate = Date.now.addingTimeInterval(3600)
            event.endDate = Date.now.addingTimeInterval(7200)
        }

        // Add default alert
        event.addAlarm(EKAlarm(relativeOffset: -900))  // 15 min before

        do {
            try eventStore.save(event, span: .thisEvent)
            let dateStr = event.startDate.map { DateHelpers.formatRelativeDate($0) } ?? "soon"
            return "📅 Event created: \"\(title)\" — \(dateStr)"
        } catch {
            return "❌ Failed to create event: \(error.localizedDescription)"
        }
    }

    // MARK: - Read Calendar

    private func readTodayCalendar() async -> String {
        do {
            let granted = try await eventStore.requestFullAccessToEvents()
            guard granted else {
                return "❌ Calendar access denied"
            }
        } catch {
            return "❌ Failed to access calendar: \(error.localizedDescription)"
        }

        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: Date.now)
        let endOfDay = calendar.date(byAdding: .day, value: 1, to: startOfDay)!

        let predicate = eventStore.predicateForEvents(
            withStart: startOfDay,
            end: endOfDay,
            calendars: nil
        )

        let events = eventStore.events(matching: predicate).sorted { $0.startDate < $1.startDate }

        if events.isEmpty {
            return "📅 No events on your calendar today"
        }

        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none

        let eventList = events.map { event in
            let time = formatter.string(from: event.startDate)
            return "• \(time) — \(event.title ?? "Untitled")"
        }.joined(separator: "\n")

        return "📅 Today's calendar:\n\(eventList)"
    }

    // MARK: - Phone Call

    @MainActor
    private func makePhoneCall(contactName: String?) -> String {
        guard let name = contactName, !name.isEmpty else {
            return "❌ No contact name provided. Say \"Call [name]\" to make a call."
        }

        // Resolve contact name to phone number via CNContactStore
        let store = CNContactStore()
        let keysToFetch: [CNKeyDescriptor] = [
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
        ]
        let predicate = CNContact.predicateForContacts(matchingName: name)

        do {
            let contacts = try store.unifiedContacts(matching: predicate, keysToFetch: keysToFetch)
            guard let contact = contacts.first,
                  let phoneNumber = contact.phoneNumbers.first?.value.stringValue else {
                return "❌ No phone number found for \"\(name)\""
            }

            // Sanitize phone number: keep digits and leading +
            let sanitized = phoneNumber.filter { $0.isNumber || $0 == "+" }
            guard let url = URL(string: "tel://\(sanitized)") else {
                return "❌ Invalid phone number for \(name)"
            }

            UIApplication.shared.open(url)
            let fullName = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespaces)
            return "📞 Calling \(fullName)..."
        } catch {
            return "❌ Could not look up contact: \(error.localizedDescription)"
        }
    }

    // MARK: - Do Not Disturb

    private func toggleDoNotDisturb() -> String {
        // No public API exists to toggle Focus/DND programmatically on iOS.
        // Direct the user to Control Center instead.
        return "🔕 Please toggle Do Not Disturb from Control Center (swipe down from the top-right corner)"
    }

    // MARK: - Camera

    @MainActor
    private func openCamera() -> String {
        // Post a notification that the UI can observe to present the camera
        NotificationCenter.default.post(name: .auraTakePhoto, object: nil)
        return "📷 Opening camera..."
    }

    // MARK: - Brightness

    @MainActor
    private func setBrightness(level: Double?) -> String {
        let targetLevel = level ?? 0.8  // Default to 80% if not specified
        let clamped = max(0, min(1, targetLevel))
        UIScreen.main.brightness = CGFloat(clamped)
        let percentage = Int(clamped * 100)
        return "🔆 Brightness set to \(percentage)%"
    }

    // MARK: - Open URL

    @MainActor
    private func openURL(_ urlString: String?) async -> String {
        guard let urlString,
              let url = URL(string: urlString),
              let scheme = url.scheme?.lowercased(),
              ["https", "http"].contains(scheme) else {
            return "❌ No valid URL provided (only http/https URLs are supported)"
        }

        UIApplication.shared.open(url)
        return "🌐 Opening \(urlString)..."
    }

    // MARK: - Search Contacts

    private func searchContacts(name: String) async -> String {
        let store = CNContactStore()

        do {
            let granted = try await store.requestAccess(for: .contacts)
            guard granted else {
                return "❌ Contacts access denied"
            }
        } catch {
            return "❌ Failed to access contacts: \(error.localizedDescription)"
        }

        let keysToFetch: [CNKeyDescriptor] = [
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
        ]

        let predicate = CNContact.predicateForContacts(matchingName: name)

        do {
            let contacts = try store.unifiedContacts(matching: predicate, keysToFetch: keysToFetch)

            if contacts.isEmpty {
                return "👤 No contacts found matching \"\(name)\""
            }

            let results = contacts.prefix(5).map { contact in
                let fullName = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespaces)
                return "• \(fullName)"
            }.joined(separator: "\n")

            return "👤 Contacts matching \"\(name)\":\n\(results)"
        } catch {
            return "❌ Contact search failed: \(error.localizedDescription)"
        }
    }
}

// MARK: - Notification Names

extension Notification.Name {
    /// Posted when the user requests to take a photo via voice command
    static let auraTakePhoto = Notification.Name("auraTakePhoto")
    /// Posted when a system command is executed (for logging)
    static let auraCommandExecuted = Notification.Name("auraCommandExecuted")
}
