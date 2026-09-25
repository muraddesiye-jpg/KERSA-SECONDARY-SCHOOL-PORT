# Kersa Secondary School — File Map

- `server.js` — Express server and protected API routes
- `package.json` — dependencies and npm scripts
- `.env.example` — required environment variables; copy to `.env`
- `.gitignore` — keeps secrets, node_modules, SQLite data and private uploads out of Git
- `.nvmrc` — Node.js 22.16.0
- `src/db.js` — built-in SQLite connection, WAL and query compatibility
- `src/init-db.js` — database/schema initialization and first administrator creation
- `src/schema.sql` — SQLite schema
- `src/auth.js` — JWT authentication and server-side role checks
- `public/index.html` — public school homepage
- `public/login.html` — portal login
- `public/register.html` — student registration and status checker
- `public/dashboard.html` — student/teacher/admin portal interface
- `public/css/style.css` — public/portal visual system
- `public/css/dashboard.css` — command center styling
- `public/css/animations.css` — animation effects
- `public/js/app.js` — homepage API integration
- `public/js/auth.js` — login/registration behavior
- `public/js/dashboard.js` — dashboard API integration and panel navigation
- `public/js/exclusive-effects.js` — existing portal effects
- `data/` — persistent SQLite database location (created at runtime)
- `private_uploads/` — private registration documents (not publicly served)
- `public/uploads/` — controlled public media such as logo/gallery assets

Protected developer credit: **Murad Desiye Buta**.
Payment UI and active payment functionality are not included.
