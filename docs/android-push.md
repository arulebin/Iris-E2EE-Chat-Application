# Android push notifications (Firebase Cloud Messaging)

The Android app can't use Web Push (WebViews have no `PushManager`), so it
registers a Firebase Cloud Messaging token instead. The backend sends each
alert to both browser subscriptions and Android devices.

Notifications only ever say **"New message"** or **"Incoming call"**. No
sender name or message content is sent, because the payload passes through
Google's servers.

Push is **off by default** on both sides. Until you finish the steps below,
the app runs normally without Android notifications.

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and create a project (Analytics isn't needed).
2. **Add app → Android**, package name **`com.iris.chat`**.
3. Download **`google-services.json`** and put it at
   `frontend/android/app/google-services.json`. It's gitignored, so don't commit it.

## 2. Enable push in the Android build

In `frontend/.env.android` (copy it from `.env.android.example`), add:

```
VITE_ANDROID_PUSH=true
```

Then rebuild with `npm run build:android`. The flag exists because calling
FCM `register()` without `google-services.json` crashes the app, so
the build has to opt in.

## 3. Give the backend a service account

1. In Firebase: **Project settings → Service accounts → Generate new private key**.
   This JSON is a **secret** that can send pushes as your project.
2. Save it as `backend/secrets/firebase-service-account.json`. The folder is
   gitignored and mounted read-only into the container at `/app/secrets`.
3. Set the env var for the backend:

   ```
   FIREBASE_CREDENTIALS_FILE=/app/secrets/firebase-service-account.json
   ```

   (Outside Docker, use the local path instead.)

At startup the backend logs `FCM enabled`, or `FCM disabled: …` if the
file is missing or invalid.

## 4. Turn it on in the app

Open **Settings → Enable notifications** on the phone. Android 13+ shows the
system permission prompt. The app creates two channels, which users can tune
under Android Settings:

| Channel | Used for | Importance |
|---|---|---|
| `messages` | New messages | High (heads-up) |
| `calls` | Incoming calls (sent high-priority so they get through Doze) | Max |

Logging out removes this device's token from the server, so the phone stops
getting alerts for that account.

## Notes

- Alerts are only sent when the recipient has no visible session open. That's
  the same rule as Web Push, so an app in the foreground gets messages over
  the WebSocket instead.
- Tokens that FCM reports as `UNREGISTERED` are deleted automatically.
- Tapping a notification just opens the app. No chat identifier is in the
  payload, by design.
