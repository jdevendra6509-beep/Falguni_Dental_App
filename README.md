# Falguni Dental App

A simple, mobile-first app for a dental clinic. **All data is saved in your own Google Sheet**, and Google
hosts the app for free (Google Apps Script). Only your Google account can open it.

- **Patients**: register patients and search by name, phone or patient number (P-0001). Allergy alerts and medical history.
- **Treatment history**: each visit with complaint, tooth chart (FDI numbering), diagnosis, treatment, notes, fee and next-visit date.
- **Accounts receivable (dues)**: fees billed vs. payments for every patient, total outstanding, ageing
  (0–30 / 31–60 / 61–90 / 90+ days; payments settle the oldest charges first), advances, one-tap WhatsApp reminders,
  a printable statement per patient, and a "Dues Report" tab written to the sheet.
- **Appointments**: day view, quick time slots, follow-up suggestions, WhatsApp appointment reminders.
- **Reports**: collections and billing by period, by payment mode (Cash/UPI/Card/...), top treatments, day by day.

## What's in the Google Sheet

The app creates these tabs automatically. You can read them, filter them and download them as Excel.

| Tab | One row per |
|---|---|
| Patients | patient |
| Visits | visit / treatment (the `fee` column is what was charged) |
| Payments | payment received |
| Appointments | appointment |
| Settings | clinic setting |
| Dues Report | patient with a balance (made when you tap "Save dues report") |

Add and change data **through the app**. Editing cells by hand works, but don't rename the tabs, the header row
or the `id` / `patient_id` columns.

## Set it up (about 5 minutes, once)

1. Go to [sheets.new](https://sheets.new) to create a blank Google Sheet, and name it e.g. *Falguni Dental Clinic*.
2. In the sheet, open **Extensions → Apps Script**.
3. Replace everything in `Code.gs` with the contents of [`apps-script/Code.gs`](apps-script/Code.gs).
4. Click **+ (Add a file) → HTML**, name it `Index` (exactly), and paste in [`apps-script/Index.html`](apps-script/Index.html).
5. Click 💾 **Save**. Choose the `setup` function in the toolbar and click **Run**. Google asks for permission:
   choose your account → *Advanced* → *Go to project (unsafe)* → *Allow*. (The warning appears because you wrote the
   script yourself rather than downloading it from a store. The script can only access this one spreadsheet.)
6. Click **Deploy → New deployment** → ⚙️ **Web app**. Set *Execute as*: **Me**, *Who has access*: **Only myself**. Click **Deploy**
   and copy the **Web app URL**.
7. Open that URL on your phone (signed in to the same Google account), then use **Add to Home Screen**.

### Updating to a newer version

Paste the new `Code.gs` / `Index.html` in the editor, save, then **Deploy → Manage deployments → ✏️ Edit →
Version: New version → Deploy**. The URL stays the same and your data is untouched.

### Letting staff (e.g. a receptionist) use it

Share the spreadsheet with their Google account as **Editor**. Then edit the deployment and set *Execute as*:
**User accessing the web app** and *Who has access*: **Anyone with a Google account**. People without access to the sheet
can open the page, but they can't read or change any data.

## For developers

```bash
npm run dev     # local preview at http://localhost:3000 (runs Code.gs against an in-memory sheet)
npm test        # backend tests
npm run build   # rebuild apps-script/Index.html from src/
```

The front end is edited in `src/` (`index.html`, `styles.css`, `app.js`) and bundled into `apps-script/Index.html`.
Everything in `apps-script/` (including `appsscript.json`) can also be uploaded with [clasp](https://github.com/google/clasp).
