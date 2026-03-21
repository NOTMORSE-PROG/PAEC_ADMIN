# PAEC Admin Panel

An admin panel for managing the training question bank of the Philippine Aeronautical English Corpus (PAEC) system. Instructors and administrators use this tool to create, review, import, and publish aviation English training questions across four exercise categories.

## Features

### Dashboard
Overview of the training question pool with per-category counts and publication status (active vs. inactive questions).

### Question Management

**Create and Edit**
Write individual training questions with a structured form tailored to each category's data model. Fields vary by category (e.g., ATC clearance + correct readback + hints for scenario questions).

**Question List**
Browse, search, filter by category, and sort the full question bank. Supports bulk selection for batch publish, unpublish, or delete operations.

**Generate from Analysis**
Upload a CSV export from the main PAEC app's analysis module. The system parses error patterns from the annotated transcript and automatically generates up to 10 candidate training questions. Review and edit candidates before approving them to the question bank.

**Import from PDF**
Upload a structured PDF following the per-category question template. The parser extracts questions and adds them to a review queue before bulk insertion. Duplicate detection prevents importing questions already in the database.

### User Management
View all registered users in the main PAEC app along with their training session counts. Supports role assignment.

### Settings
Update admin email address and change the admin account password.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, React 19) |
| Language | TypeScript 5.3 |
| Styling | Tailwind CSS 3.4 |
| Database | PostgreSQL (shared with main PAEC app) |
| Auth | NextAuth.js 5 (JWT, credentials provider) |
| PDF Parsing | PDF.js (pdfjs-dist) |
| Icons | Lucide React |

## Project Structure

```
corpus-admin/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/          # NextAuth handler
│   │   │   ├── admin/         # Change email and password endpoints
│   │   │   ├── questions/     # CRUD, generate, bulk insert, import PDF
│   │   │   └── users/         # User list and role management
│   │   ├── auth/login/        # Admin login page
│   │   ├── dashboard/
│   │   │   ├── page.tsx       # Overview stats
│   │   │   ├── questions/     # List, create, edit, generate, import
│   │   │   ├── users/         # User management
│   │   │   └── settings/      # Admin profile settings
│   │   └── unauthorized/      # 403 page
│   ├── lib/
│   │   ├── auth.ts            # NextAuth configuration
│   │   ├── database.ts        # PostgreSQL queries and types
│   │   ├── csvParser.ts       # Parses PAEC analysis CSV exports
│   │   ├── pdfQuestionParser.ts  # Extracts questions from PDFs by category
│   │   └── questionGenerator.ts  # Auto-generates candidate questions
│   └── components/
│       └── ScrollToTop.tsx
├── scripts/
│   ├── seed-admin.js          # Creates the initial admin user
│   └── seed-questions.js      # Populates sample questions
├── .env.local.example         # Environment variable template
├── next.config.js
├── tailwind.config.ts
└── package.json
```

## Question Categories

| Category | Description |
|---|---|
| `scenario` | ATC clearance paired with correct pilot readback, optional hints |
| `readback` | Incorrect vs. correct readback pairs for error identification |
| `jumbled` | A correct pilot phrase broken into words to be reordered |
| `pronunciation` | ICAO digit and letter pronunciation drills |

## Setup

### Prerequisites

- Node.js 18 or later
- The main PAEC app database already initialized (shared schema)
- Access to the same PostgreSQL instance used by the main app

### Environment Variables

Copy `.env.local.example` to `.env.local` and fill in all values:

```env
# PostgreSQL connection string (same database as the main PAEC app)
DATABASE_URL=postgresql://username:password@host:port/database?sslmode=require

# Must match AUTH_SECRET in the main PAEC app
AUTH_SECRET=your-shared-secret-here

# External URL of this admin panel
NEXTAUTH_URL=http://localhost:3001
```

`AUTH_SECRET` must be identical to the value used in the main PAEC app so that session tokens are valid across both applications.

### Installation

```bash
# Navigate into the admin directory
cd corpus-admin

# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local with your credentials

# Create the initial admin user
npm run seed:admin
# Default credentials: admin@paec.local / admin
# Change the password immediately after first login via Settings

# Start the development server
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) to access the admin panel.

### Available Scripts

```bash
npm run dev          # Start development server (http://localhost:3001)
npm run build        # Build for production
npm start            # Start production server
npm run lint         # Run ESLint
npm run seed:admin   # Create the initial admin user (safe to re-run)
```

## Seed Scripts

**seed-admin.js** — Creates an admin user with `admin@paec.local` / `admin`. Checks for existence first so it is safe to run multiple times. Change the password after first login.

**seed-questions.js** — Populates the question bank with sample questions for all four categories. Useful for development and testing.

## Generating Questions from Analysis

1. Run an analysis session in the main PAEC app and export the results as CSV.
2. In the admin panel, go to **Questions > Generate from Analysis** and upload the CSV.
3. The system reads the error summary and annotated transcript sections, then produces up to 10 candidate questions distributed across categories.
4. Review and edit each candidate, then approve to insert into the question bank.

## Importing Questions from PDF

1. Download the per-category PDF template from the import page.
2. Write questions following the template format (labelled fields: `ATC:`, `CORRECT:`, `HINTS:`, etc.).
3. Upload the PDF in **Questions > Import from PDF**.
4. Review the parsed questions and resolve any duplicates flagged by the system.
5. Confirm to bulk-insert the approved questions.

## Notes

- This panel is restricted to users with the `admin` role. Authenticated non-admin users are redirected to `/unauthorized`.
- The admin panel runs on port **3001** by default to avoid conflicts with the main app on port 3000.
- Both apps share the same PostgreSQL database and the same `AUTH_SECRET`.

## License

All rights reserved. This tool is part of the PAEC project at PhilSCA.
