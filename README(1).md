# Kersa Secondary School — Aurora No-Payment Portal (SQLite)

This version keeps the existing Kersa Aurora portal UI and application structure while replacing the failed remote PostgreSQL/Neon database layer with a local SQLite database.

## Stack
- Node.js 22.13+ (uses the built-in `node:sqlite` module)
- Express
- SQLite with WAL mode
- bcryptjs authentication
- JWT + HTTP-only cookie sessions
- Multer for controlled file uploads
- Browser WebRTC + SQLite-backed meeting signaling

## Quick start

1. Install Node.js 22.13 or newer.
2. Open this project folder in VS Code.
3. Copy `.env.example` to `.env`.
4. Set strong values for `JWT_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, and the admin credentials.
5. Install dependencies:
   `npm install`
6. Create the SQLite database and administrator:
   `npm run db:init`
7. Start the portal:
   `npm start`
8. Open `http://localhost:3000`.

The default database file is `data/kersa.sqlite`. You can change it with `SQLITE_PATH` in `.env`.

## Database behavior

The database is created automatically in the `data/` directory. The application enables foreign-key enforcement, WAL journaling, a 10-second busy timeout, and SQLite's `synchronous=NORMAL` setting for a practical performance/safety balance.

Do not place the SQLite database on a network filesystem. Keep the database file and the application on the same host/storage volume.

## Admin

The admin account is created by `npm run db:init` only if it does not already exist. If it already exists, its password is not overwritten.

The developer credit **Murad Desiye Buta** remains protected by the application and is not an editable admin setting.

## No-payment mode

The active portal contains no payment gate or payment workflow. Legacy payment tables remain only for non-destructive compatibility with the previous version and are not used by the application.

## Google indexing

After deployment, the portal exposes:
- `/robots.txt`
- `/sitemap.xml`

Submit the public sitemap URL in Google Search Console after the production domain is live.

## Important deployment note

SQLite is a file database. A deployment platform must provide persistent storage for `data/kersa.sqlite`, otherwise database changes can disappear when an instance is replaced. For a multi-instance/high-write production deployment, use a managed server database instead.
