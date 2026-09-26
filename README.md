# FinTech Instant Loan Application

A complete mobile-first fintech platform for instant loan applications with real-time approval and disbursement.

## Project Structure

```
project-fintech/
├── backend/              # Node.js/Express API
│   ├── src/
│   │   ├── models/       # Database models
│   │   ├── routes/       # API endpoints
│   │   ├── controllers/  # Business logic
│   │   ├── middleware/   # Auth, validation
│   │   └── config/       # Configuration
│   ├── .env.example
│   └── package.json
└── mobile/               # Flutter app
    ├── lib/
    │   ├── screens/      # UI screens
    │   ├── models/       # Data models
    │   ├── services/     # API services
    │   └── widgets/      # Reusable widgets
    └── pubspec.yaml
```

## Features

### MVP Phase 1 (Current)
- [x] User authentication (signup/login)
- [x] Loan application form
- [ ] KYC verification
- [ ] Instant approval system
- [ ] Loan disbursement tracking
- [ ] Repayment management

## Tech Stack

**Backend:**
- Node.js + Express.js
- MongoDB (database)
- JWT (authentication)
- RESTful API

**Mobile:**
- Flutter (Dart)
- Provider (state management)
- Dio (HTTP client)

## Getting Started

### Backend Setup
```bash
cd backend
npm install
npm run dev
```

### Mobile Setup
```bash
cd mobile
flutter pub get
flutter run
```

## API Documentation
See `backend/API_DOCS.md` for detailed API endpoints.

## Author
Generated with Claude Code
