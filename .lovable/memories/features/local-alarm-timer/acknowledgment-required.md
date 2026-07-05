---
name: Timer/Alarm Acknowledgment Required
description: All timer and alarm alerts must stay visible until manually acknowledged; no auto-dismiss timeout.
type: feature
---
Timer and alarm alerts are always modal and require explicit user acknowledgment.

- The alert overlay remains visible until the user presses “Kvittera”.
- There is no auto-dismiss timeout; the previous “Visa alert i (sekunder)” field is removed.
- Push notifications are still sent once per alert, but do not dismiss the in-app alert.
- Acknowledgment clears the overlay and marks the shared_timer row inactive (via cancel).
