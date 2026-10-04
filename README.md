# UniVibe

> **A space full of goooood vibes.**

UniVibe is a campus social platform designed to bring students, clubs, events, and campus conversations together in one place.

It combines the visual and social feel of a campus-wide feed with more personal, community-driven spaces for clubs and events.

## 🌐 Live Demo

**[Visit UniVibe](https://univibe-campus.netlify.app/)**

---

## ✨ Features

### 🏠 Campus Feed
- Share campus-wide posts
- Upload photos with posts
- View posts from other students
- Comment and reply to discussions
- Threaded conversations
- Creator-only post deletion

### 🎪 Events
- Discover upcoming campus events
- Create and manage events
- View event details and discussions
- Mark events as **Interested** or **Not Interested**
- Event-specific comments and replies
- Upload event photos

### 👥 Clubs
- Discover campus clubs
- Create and join clubs
- Club-specific posts and discussions
- Create club announcements and events
- Custom club logos
- Club member lists
- Configurable member limits
- Club owner settings

### 👤 Profiles
- Custom profile names and campus handles
- Profile bio
- Profile picture
- View personal posts
- View joined clubs
- View interested events
- Edit profile information

### 🔐 Authentication
- Account creation and login
- Logout
- Guest browsing
- Authenticated actions for creating content
- Supabase-powered authentication

### 🎨 UI & Experience
- Responsive desktop and mobile layouts
- Light and dark themes
- Warm, campus-oriented visual design
- Instagram-inspired social feed
- Reddit/Discord-inspired community spaces
- Smooth intro and welcome experience

---

## 🛠️ Tech Stack

- **HTML5**
- **CSS3**
- **Vanilla JavaScript (ES6)**
- **Supabase**
  - Authentication
  - PostgreSQL database
  - Row Level Security
  - Storage
- **Git & GitHub**
- **Netlify**

UniVibe is intentionally built without a frontend framework or bundler. The application uses a lightweight vanilla JavaScript architecture.

---

## 📁 Project Structure

```text
UniVibe/
│
├── index.html
│
├── css/
│   ├── components.css
│   ├── feed.css
│   ├── intro.css
│   ├── layout.css
│   └── tokens.css
│
├── js/
│   ├── auth.js
│   ├── create.js
│   ├── feed.js
│   ├── intro.js
│   ├── media.js
│   ├── supabase.js
│   └── theme.js
│
├── schema.sql
├── migration_add_title.sql
├── schema_auth_autoconfirm.sql
├── schema_club_posts.sql
├── schema_clubs.sql
├── schema_comments.sql
├── schema_event_comments.sql
├── schema_events.sql
├── schema_home_and_events.sql
├── schema_media.sql
├── schema_ownership_deletion.sql
├── schema_profiles.sql
├── schema_threaded_replies.sql
│
├── .env.example
├── env.example.js
├── .gitignore
├── package.json
└── serve.bat
