# Vault — Apple-Designed Personal Money & Spending Tracker

A minimal, high-precision personal finance engine and daily spending tracker built with Apple Human Interface Guidelines, IndexedDB durable storage, and PWA capabilities.

## Features

- **Apple Human Interface Design**: OLED pitch-black aesthetic, translucent frosted glass materials (`backdrop-filter: blur(25px)`), native SF typography, and tactile active-press animations.
- **Daily Spending Logger**: Quick-entry bottom sheet drawer with smart category chips, quick tag presets, and note descriptions.
- **Real-Time Balance Calibration**: Set your exact available liquid funds anytime. Vault dynamically tracks: `Current Funds = Baseline + Inflows - Expenses`.
- **Durable IndexedDB Engine**: Stores transactions, baseline adjustments, and preferences directly in browser IndexedDB with `navigator.storage.persist()` to prevent eviction.
- **PWA & Daily Reminders**: Installable as a standalone app on iOS and Android with background service worker caching and daily spending notification reminders.
- **Data Export & Analytics**: Full JSON backup and CSV transaction export ready for Excel, Apple Numbers, and custom analytics pipelines.

## Tech Stack

- Semantic HTML5 & CSS3 custom properties
- Modern ES6+ JavaScript
- IndexedDB (`VaultDB`)
- Chart.js (custom dark theme)
- Service Worker & Web Notifications API
- PWA Web App Manifest

## License

MIT
