# ProxyGuard — Smart Attendance System with Anti-Proxy Protection

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express-v5.2-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![License](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

**ProxyGuard** is a full-stack, progressive web application designed to eliminate student attendance proxy in academic classrooms. By combining **dynamically rotating HMAC-SHA256 signed QR codes** with **real-time classroom geo-fencing**, ProxyGuard ensures that only students physically present in the lecture hall during the designated session can mark their attendance.

---

## Key Features

### 1. Cryptographic Anti-Proxy Protection
- **Dynamic Rotating QR Codes**: The faculty screen projects QR codes that refresh every 20 seconds.
- **HMAC-SHA256 Token Signing**: Each QR payload contains `session_id`, `timestamp`, and a signature generated using a cryptographically random session secret that never leaves the server.
- **30-Second Token Window**: Tokens expire 30 seconds after generation, preventing students from screenshotting and sharing codes via messaging apps.
- **Single-Use Enforcement**: Enforced by compound unique indexing on `{ session: 1, student: 1 }` at both application and database layers.

### 2. Classroom Geo-fencing
- **Haversine Distance Validation**: When enabled by the faculty member, student GPS coordinates are validated against classroom coordinates on the server.
- **Configurable Radius**: Defaults to a 150-meter perimeter around the lecture hall. Scans outside the perimeter are rejected and logged as forensic security events.

### 3. Student Portal
- **Summary Stat Cards**: Real-time cards displaying overall attendance percentage, courses below 75%, total sessions attended, and last scan time.
- **Compact Monthly Calendar**: Square calendar grid (~44–52px cells) highlighting today, attended days (green badge), and click-to-view class timestamps.
- **Responsive Activity Heatmap**: Visualizes scan frequency across past weeks with dynamic intensity levels.
- **75% Exam Eligibility Warnings**: Automatic shortfall projection calculating exact consecutive classes needed to restore exam eligibility.

### 4. Faculty Dashboard & Analytics
- **Live Attendance Projector**: Prominent live QR projection card with real-time countdown progress bar.
- **Live Scanned Roster**: Instant roster display showing student names, avatars, and scan timestamps.
- **Course Subject Registry**: Create and manage distinct academic courses.
- **Reports & Analytics**: Turnout percentage comparisons, weekly attendance trends, and CSV attendance exports protected against spreadsheet formula injection.

### 5. Administrator Command Center
- **Institutional Metrics**: High-level tracking of total students, faculty, subjects, sessions, and scans.
- **User Directory**: Searchable management table with protected administrator accounts.
- **Forensic Security Audit Trail**: Real-time security event logging for duplicate scans, geo-fence breaches, expired token reuse, and failed logins.

---

## Technology Stack

- **Runtime**: Node.js
- **Backend Framework**: Express.js 5.x
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JSON Web Tokens (JWT) with bcrypt password hashing
- **Cryptography**: Node.js `crypto` (HMAC-SHA256 and `timingSafeEqual`)
- **Frontend**: Plain HTML5, CSS3 (Custom Design System with CSS Custom Properties), Vanilla JavaScript
- **Client QR Engine**: `html5-qrcode` (served locally for 100% offline support)
- **Progressive Web App**: Custom Service Worker precaching static assets with offline capabilities and Web App Manifest

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18 or higher recommended)
- [MongoDB](https://www.mongodb.com/) (local instance or MongoDB Atlas cluster)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/proxyguard.git
   cd proxyguard
   ```

2. **Install project dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy the `.env.example` template to `.env`:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and set your configuration values:
   - `PORT`: Port number for the Express server (default: `5000`)
   - `MONGO_URI`: MongoDB connection string
   - `JWT_SECRET`: A secure, random secret key for signing user tokens
   - `ADMIN_NAME`: Initial administrator full name
   - `ADMIN_EMAIL`: Initial administrator email address
   - `ADMIN_PASSWORD`: Strong password for administrator access (minimum 8 characters)

4. **Seed the Initial Administrator Account:**
   ```bash
   node createAdmin.js
   ```

5. **Start the Development Server:**
   ```bash
   npm run dev
   ```
   Or run in production:
   ```bash
   npm start
   ```

6. **Access the Application:**
   Open your browser and navigate to: `http://localhost:5000`

---

## Deployment to Vercel (Zero-Config Express)

ProxyGuard is configured for zero-config serverless deployment on [Vercel](https://vercel.com/):
- **Zero-Config Routing**: Vercel automatically detects `server.js` at the repository root and routes `/api/*` requests to a serverless fluid compute function without requiring a `vercel.json` file.
- **Edge CDN Static Serving**: All assets in `public/` (`index.html`, `student.html`, `teacher.html`, `admin.html`, `reports.html`, CSS, icons, and `/lib/html5-qrcode.min.js`) are served directly by Vercel's global CDN edge network with automatic caching.
- **Serverless Connection Pooling**: MongoDB connection promises are cached across container invocations, eliminating cold-start connection latency while preserving the 503 database availability gate when unreachable.

### 1. Database Setup (MongoDB Atlas)
Because Vercel serverless functions run in ephemeral containers across dynamic IP addresses, production requires a cloud-hosted database such as [MongoDB Atlas](https://www.mongodb.com/cloud/atlas):
1. In MongoDB Atlas, go to **Network Access** and add `0.0.0.0/0` (Allow Access from Anywhere) to permit connections from Vercel's serverless IP ranges.
2. In **Database Access**, create a database user and record the username and password.
3. In **Database Deployments**, click **Connect** → **Drivers** (Node.js) and copy the connection string:
   ```
   mongodb+srv://<username>:<password>@cluster.mongodb.net/proxyguard?retryWrites=true&w=majority
   ```

### 2. Seed the Admin User (One-time)
Run the seed script locally against your Atlas cluster before first login:
```bash
MONGO_URI="mongodb+srv://<username>:<password>@cluster.mongodb.net/proxyguard?retryWrites=true&w=majority" ADMIN_EMAIL="admin@college.edu" ADMIN_PASSWORD="your_strong_password" node createAdmin.js
```

### 3. Deploy to Vercel

#### Option A: Via Vercel Web Dashboard (Recommended)
1. Push your repository to GitHub, GitLab, or Bitbucket.
2. Log into [vercel.com](https://vercel.com/) and click **Add New...** → **Project**.
3. Import the `proxyguard` repository.
4. Under **Environment Variables**, configure the following variables:
   - `MONGO_URI`: `mongodb+srv://<username>:<password>@cluster.mongodb.net/proxyguard?retryWrites=true&w=majority`
   - `JWT_SECRET`: A secure random string of at least 16 characters (e.g. generated via `openssl rand -hex 32`)
   - `NODE_ENV`: `production`
5. Click **Deploy**.

#### Option B: Via Vercel CLI
1. Install the Vercel CLI:
   ```bash
   npm i -g vercel
   ```
2. Run deployment from the project root:
   ```bash
   vercel
   ```
3. Set the environment variables in the project settings or via CLI:
   ```bash
   vercel env add MONGO_URI production
   vercel env add JWT_SECRET production
   vercel env add NODE_ENV production
   ```
4. Deploy to production:
   ```bash
   vercel --prod
   ```

---

## Automated Security Tests

ProxyGuard includes a non-destructive unit test suite verifying core security primitives:
- HMAC-SHA256 token signing, timing-safe equality, and signature tampering defense
- 30-second token expiration enforcement
- Geo-fencing Haversine distance calculations and coordinate boundary checks
- CSV formula injection sanitization (`=`, `+`, `-`, `@` neutralization)
- Bcrypt password hashing and salt verification

To run tests:
```bash
npm test
```

---

## Anti-Proxy Architecture & Known Considerations

| Mechanism | Protection Provided | Operational Note |
| :--- | :--- | :--- |
| **Rotating HMAC Tokens** | Prevents forged or static QR code reuse. | Requires faculty screen to be visible to the lecture hall. |
| **30-Second TTL** | Prevents screenshot sharing via messaging apps outside the room. | System clocks should be synchronized via NTP. |
| **Geo-fencing** | Prevents attendance marking from outside campus boundaries. | Requires faculty device to grant browser location permission when starting session. |
| **Unique Indexing** | Prevents duplicate attendance submissions per session. | Enforced directly by MongoDB compound index `{ session: 1, student: 1 }`. |

---

## License

This project is licensed under the [ISC License](LICENSE).
