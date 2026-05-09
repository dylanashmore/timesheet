# D Ramos Enterprises — Attendance Tracker

## Deploy to Vercel (step by step)

### 1. Put the files on GitHub
1. Go to github.com → sign in or create a free account
2. Click "+" → "New repository" → name it "dramos-attendance" → Create
3. Click "uploading an existing file" and drag in ALL files/folders from this zip
4. Click "Commit changes"

### 2. Deploy on Vercel
1. Go to vercel.com → sign in with your GitHub account
2. Click "Add New Project" → select "dramos-attendance"
3. Before clicking Deploy, open "Environment Variables" and add:
   Name:  MONGO_URI
   Value: your MongoDB Atlas connection string (see below)
4. Click Deploy — in ~30 seconds you get a live public URL

### 3. Get your MongoDB Atlas connection string
1. Log into mongodb.com/atlas
2. Click "Connect" on your cluster → "Drivers"
3. Copy the string, replace <password> with your real password
4. Add "dramos" as the database name before the "?":
   mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/dramos?retryWrites=true&w=majority

### 4. Allow Vercel to reach Atlas
MongoDB Atlas → Network Access → Add IP Address → Allow Access from Anywhere (0.0.0.0/0)

Done. Share the Vercel URL with anyone who needs it.

## PINs
- 1234 → Boss (submit attendance, view records, manage workers)
- 5678 → Viewer (view records and download spreadsheets only)

To change PINs: open index.html, find the PINS object near the top of the script.

## File structure
  index.html        — the full frontend
  vercel.json       — Vercel routing config
  package.json      — dependencies
  api/
    _db.js          — shared MongoDB connection
    workers/
      index.js      — GET all workers, POST new worker
      [id].js       — PATCH wage, DELETE worker
    records/
      index.js      — GET records, POST attendance
      [id].js       — DELETE record
