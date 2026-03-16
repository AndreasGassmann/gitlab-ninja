# Chrome Web Store — Permission Justifications

These justifications are required when submitting to the Chrome Web Store.

## `storage`

Used to persist user settings (GitLab instance URL, personal access token, theme preference, feature toggles) locally on the device. No data is sent to external servers.

## `activeTab`

Used to detect whether the current tab is a GitLab board page so the extension can activate its features. The extension only reads the tab URL — it does not access page content through this permission.

## `tabs`

Used to open GitLab issues in new tabs when the user clicks quick-estimate buttons or creates issues from the popup. Also used to detect navigation to board pages.

## `alarms`

Used to schedule periodic reminders for daily time tracking goals. The user configures the reminder interval in the extension settings.

## `notifications`

Used to display browser notifications when a time tracking reminder fires. Notifications are only shown if the user has explicitly enabled reminders in settings.

## `scripting`

Used to inject the content script into GitLab board pages that match the user's configured GitLab domain. Required for dynamic host permission support (self-hosted instances).

## Host permissions (`https://*/*` — optional)

Requested at runtime only when the user configures a self-hosted GitLab instance. Grants access to the user's specific GitLab domain so the extension can read board data and make API calls to their instance.
