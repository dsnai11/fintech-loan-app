# Turning on push notifications

The server side is finished and tested. It sends a push for every notification the system creates (loan approved,
EMI reminder, overdue notice, reply from support, announcement, referral reward) as soon as Firebase is connected.
Until then, alerts still appear in the bell inside the app and nothing breaks.

Two things are needed: connect the server to Firebase (a settings change), and add Firebase to the phone app (a build change).

## 1. Create the Firebase project (free)

1. Go to https://console.firebase.google.com and create a project (any name, for example "LIFC").
2. Project settings, Cloud Messaging: make sure "Firebase Cloud Messaging API (V1)" is enabled.

## 2. Connect the server (no new app needed for this part)

1. Project settings, Service accounts, "Generate new private key". A `.json` file downloads. Keep it private.
2. In the web portal open **Integrations**, find **Push notifications (Firebase)** and enter:
   - Provider: `fcm`
   - Firebase project ID: `project_id` from the file
   - Service account email: `client_email` from the file
   - Service account private key: `private_key` from the file (the whole text, including the BEGIN and END lines)
3. Save. The card should say **Live**.

From now on, announcements sent from **Messages** have an "Also send as a push notification" option.

## 3. Add Firebase to the phone app (a new build)

Android:
1. In Firebase, Project settings, add an Android app with the package name `com.fintech.loan`.
2. Download `google-services.json` and put it in `mobile/android/app/`.

iPhone:
1. Add an iOS app in Firebase with the bundle identifier the iOS build uses.
2. Download `GoogleService-Info.plist`.
3. In your Apple developer account create an APNs key, and upload it in Firebase, Project settings, Cloud Messaging.

Then ask for the app change: add `firebase_core` and `firebase_messaging` to `mobile/pubspec.yaml`, switch on the Google
services plugin for Android, and fill in the three marked spots in `mobile/lib/services/push_service.dart`
(`supported`, `deviceToken()`, `requestPermission()`). The build is checked on GitHub as usual.

## 4. Check it

1. Install the new build, sign in, open Profile, Notifications, and tap "Turn on notifications".
2. In the portal, send an announcement to yourself with the push option ticked.
3. Close the app and confirm the alert arrives.

## Notes

- Customers can switch off EMI reminders, replies and offers. Loan and payment alerts are always on.
- A customer's last five phones receive alerts. A phone that has removed the app is forgotten automatically.
- Marketing pushes need the customer's consent under Indian rules on commercial messages. Ask your compliance team how
  the Notifications screen should word it.
