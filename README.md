# Falguni Dental App

A simple, mobile-first app for a dental clinic. **All data is saved in your own Google Sheet**, and Google
hosts the app for free (Google Apps Script).

- **Two logins**: *Doctor* and *Compounder*, each with their own password.
- **Patients**: register patients and search by name, phone or patient number (P-0001). Allergy alerts and medical history.
- **Treatment history**: each visit with complaint, tooth chart (FDI numbering), diagnosis, treatment, notes, fee and next-visit date.
- **Appointments with automatic reminders**:
  - every appointment is added to a **“Clinic Appointments” Google Calendar** with a pop-up alert, so it rings on the doctor’s phone;
    the compounder receives each one as a calendar invite;
  - a **7 am email** to the doctor and compounder lists the day’s appointments, with one-tap WhatsApp reminder links for each patient;
  - patients who have an email address get an **automatic reminder email the day before**.
- **Dues (accounts receivable)**: billed vs. paid per patient, ageing (0–30 / 31–60 / 61–90 / 90+ days), WhatsApp payment reminders,
  printable statements, and a “Dues Report” tab.
- **Income & expenses**: record expenses (rent, salary, materials, lab, travel…) and other income (sponsorships, camp fees…),
  each either for the **regular clinic** or for an **event** (dental camp, school check-up, corporate drive…).
  Patient visits and payments made on an event’s dates are tagged to that event automatically.
- **Profitability**: profit & loss for any period, split into regular clinic vs. events, plus the profit and margin of **each event**.

## Who can do what

| | Doctor | Compounder |
|---|:-:|:-:|
| Patients: add, edit, view history | ✅ | ✅ |
| Book / change / cancel appointments | ✅ | ✅ |
| Add visits and receive payments | ✅ | ✅ |
| See dues and send reminders | ✅ | ✅ |
| Edit or delete visits and payments, delete patients | ✅ | — |
| Expenses, other income, events, profit & loss, reports | ✅ | — |
| Settings, passwords, the Google Sheet link | ✅ | — |

(The rules are in `Code.gs`: each route is marked `STAFF` or `DOCTOR`.)

## What's in the Google Sheet

The app creates these tabs itself: **Patients, Visits, Payments, Appointments, Events, Expenses, Income, Settings**
(plus **Dues Report** when you ask for it). You can read, filter and download them as Excel. Add and change data
**through the app**; don't rename the tabs or the header row. Passwords are *not* stored in the sheet.

## Set it up (about 10 minutes, once — on the doctor’s Google account)

1. Go to [sheets.new](https://sheets.new) to create a blank Google Sheet, and name it e.g. *Falguni Dental Clinic*.
2. In the sheet, open **Extensions → Apps Script**.
3. Replace everything in `Code.gs` with the contents of [`apps-script/Code.gs`](apps-script/Code.gs).
4. Click **+ (Add a file) → HTML**, name it `Index` (exactly), and paste in [`apps-script/Index.html`](apps-script/Index.html).
5. Click 💾 **Save**. Choose the `setup` function in the toolbar and click **Run**. Google asks for permission:
   choose your account → *Advanced* → *Go to project (unsafe)* → *Allow*. (The warning is shown because you wrote the
   script yourself rather than installing it from a store.) This creates the tabs, the “Clinic Appointments” calendar
   and the 7 am reminder job.
6. Click **Deploy → New deployment** → ⚙️ **Web app**. Set *Execute as*: **Me** and *Who has access*: **Anyone**. Click **Deploy**
   and copy the **Web app URL**. (“Anyone” only means the login page opens without a Google account; nothing can be seen or
   changed without the doctor’s or compounder’s password.)
7. Open the URL on your phone. The first time, it asks for the clinic name and **two passwords** (doctor and compounder) and
   your email addresses for reminders. Then use **Add to Home Screen**. Share the same URL with the compounder.

**Phone alerts**: install the **Google Calendar** app on the doctor’s phone (signed in to the same Google account) and make sure the
“Clinic Appointments” calendar is switched on. The compounder should use the Google Calendar app with the email you entered for them.
You can change the alert time, and switch any reminder on or off, under **More → Logins & reminders**, which also has a
“Send me a test reminder” button.

### Updating to a newer version

Paste the new `Code.gs` / `Index.html` in the editor, save, run `setup` once more, then **Deploy → Manage deployments → ✏️ Edit →
Version: New version → Deploy**. The URL stays the same and your data is untouched (new columns are added automatically).

### Forgot a password?

The doctor can change either password under **More → Logins & reminders**. If the doctor's own password is lost, open the
Apps Script editor → ⚙️ **Project Settings** → **Script properties**, delete `pw:doctor` and `pw:compounder`, then open the app:
it will ask for new passwords (all data is kept).

## For developers

```bash
npm run dev     # local preview at http://localhost:3000 (runs Code.gs against an in-memory sheet)
npm test        # backend tests
npm run build   # rebuild apps-script/Index.html from src/
```

The front end is edited in `src/` (`index.html`, `styles.css`, `app.js`) and bundled into `apps-script/Index.html`.
Everything in `apps-script/` (including `appsscript.json`) can also be uploaded with [clasp](https://github.com/google/clasp).
