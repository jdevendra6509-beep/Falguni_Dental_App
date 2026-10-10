# Falguni Dental App

A simple, mobile-first web app for a dental clinic:

- **Patients** – register patients, search by name / phone / patient number (P-0001), allergy alerts, medical history.
- **Treatment history** – every visit with complaint, tooth chart (FDI numbering), diagnosis, treatment, notes, fee and next-visit date, shown as a timeline.
- **Accounts receivable (dues)** – fees billed vs. payments received for every patient, total outstanding,
  ageing (0–30 / 31–60 / 61–90 / 90+ days, oldest charges are settled first), advances, one-tap WhatsApp payment reminders,
  and a printable statement of account per patient.
- **Appointments** – day view with date strip, quick time slots, follow-up suggestions, WhatsApp appointment reminders.
- **Reports** – collections and billing by period, by payment mode (Cash/UPI/Card/...), top treatments, day-by-day.
- **Your data** – one-tap full backup (SQLite file) and CSV/Excel exports.
- **Installable** – “Add to Home Screen” on Android/iPhone and it opens like an app.

Password-protected (set on first launch). All data is stored in a single SQLite file: `data/clinic.db`.

## Run it

Needs **Node.js 22.13 or newer** — there are no other dependencies to install.

```bash
npm start
```

Open http://localhost:3000 and choose your clinic password. To use it from your phone on the same Wi‑Fi,
open the “On your phone” address that is printed when the server starts.

| Setting | Default | |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `DB_FILE` | `data/clinic.db` | Where the database lives |

## Put it online (use it from anywhere)

The app needs a host with a **persistent disk** for the database file (e.g. Render with a disk, Railway with a volume,
Fly.io with a volume, or any small VPS). With Docker:

```bash
docker build -t dental-app .
docker run -d -p 3000:3000 -v dental-data:/data dental-app
```

Always serve it over **HTTPS** when it is on the internet (these platforms do that for you).

## Backups

Go to **More → Download full backup** regularly and keep the file somewhere safe (Google Drive, email, pen drive).
To restore, stop the app and replace `data/clinic.db` with the backup file.

## Tests

```bash
npm test
```
