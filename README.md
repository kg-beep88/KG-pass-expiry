# KG Pass & License Tracker

A simple phone-friendly website for tracking worker/foreman **site pass** and **license** expiry dates.

## What this version does

- Uses **2 PINs**:
  - **View PIN:** `1234` — can see list only.
  - **Edit PIN:** `hengonghuat` — can add, edit and delete.
- Sends daily email alerts to:
  - shayne@kgplasterceil.com.sg
  - kgchesterlee@gmail.com
- Tracks 2 main item types:
  - **Pass:** MBS, VSMC, and any other site pass you type.
  - **License:** BCSS, Work Permit, Driving License, and any other license you type.
- One person can have many passes and many licenses.
- Search box can filter by name, nickname, role, pass name, license name, MBS, BCSS, work permit, etc.
- View page lists the earliest/most urgent expiry items on top.
- Edit PIN can delete a person and the rows are removed from Google Sheet.

## Expiry colour rules

### Pass

- **Red** = expired already or expiring within 15 days
- **Yellow** = expiring in 16–30 days
- **Normal** = more than 30 days left

### License

- **Red** = expired already or expiring within 35 days
- **Yellow** = expiring in 36–60 days
- **Normal** = more than 60 days left

The email includes all **red** and **yellow** pass/license items.

## Donkey simple explanation

Think of the system like this:

1. **GitHub Pages** = the shop front. Staff open this website.
2. **Google Sheet** = the notebook. All names and expiry dates save here.
3. **Google Apps Script** = the worker behind the counter. It checks PIN, saves data, deletes data, and sends email.

GitHub alone cannot send daily email. That is why Google Apps Script is needed.

---

# Setup

## Part 1 — Create the Google Sheet backend

1. Create a new Google Sheet.
2. Name it `KG Pass License Database`.
3. Click **Extensions → Apps Script**.
4. Delete the sample code.
5. Open this project folder: `apps-script/Code.gs`.
6. Copy everything inside `Code.gs`.
7. Paste it into Apps Script.
8. Confirm the PINs at the top are correct:

```javascript
VIEW_PIN: '1234',
EDIT_PIN: 'hengonghuat',
```

9. Confirm email list is correct:

```javascript
ALERT_EMAILS: ['shayne@kgplasterceil.com.sg', 'kgchesterlee@gmail.com'],
```

10. Click **Save**.
11. Select function `initialSetup` at the top.
12. Click **Run**.
13. Approve Google permissions.

This creates the Google Sheet tabs and daily email trigger.

## Part 2 — Deploy Apps Script as Web App

1. In Apps Script, click **Deploy → New deployment**.
2. Click the gear icon.
3. Choose **Web app**.
4. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
5. Click **Deploy**.
6. Copy the URL ending with `/exec`.

Important: use the `/exec` URL, not `/dev`.

## Part 3 — Connect website to backend

1. Open `config.js`.
2. Replace this:

```javascript
SCRIPT_URL: "PASTE_YOUR_APPS_SCRIPT_WEB_APP_EXEC_URL_HERE"
```

with your Apps Script `/exec` URL.

Example:

```javascript
SCRIPT_URL: "https://script.google.com/macros/s/YOUR_LONG_ID_HERE/exec"
```

3. Save `config.js`.

## Part 4 — Upload to GitHub Pages

1. Create a GitHub repository.
2. Upload these website files to the repository root:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `config.js`
   - `manifest.webmanifest`
   - `service-worker.js`
   - `icon.svg`
   - `.nojekyll`
3. You can keep `apps-script/Code.gs` as your own reference. Do not share your edit PIN publicly.
4. Go to **Settings → Pages**.
5. Choose **Deploy from branch**.
6. Choose branch **main**, folder **/(root)**.
7. Click **Save**.

## Test

1. Open the GitHub Pages website.
2. Enter the **Edit PIN:** `hengonghuat`.
3. Add one worker.
4. Add:
   - Site pass: `MBS`, expiry 10 days from today.
   - License: `BCSS`, expiry 40 days from today.
5. The MBS pass should be **red**.
6. The BCSS license should be **yellow**.
7. In Apps Script, run `sendTestEmail`.
8. Check both email inboxes.
9. Log out and enter **View PIN:** `1234`. Add/Edit/Delete buttons should not appear.

## Daily email timing

The backend sends daily email around **8 AM Singapore time**.

To change the time, edit:

```javascript
DAILY_EMAIL_HOUR: 8,
```

Then run `initialSetup` again.

## When you change Apps Script code

After changing `Code.gs`, deploy again:

**Deploy → Manage deployments → Edit pencil → Version → New version → Deploy**

If you do not deploy a new version, the website may still use the old backend.

## Common error: Could not contact Apps Script

Check these:

1. `config.js` URL must end with `/exec`.
2. Apps Script deployment must be:
   - Execute as: **Me**
   - Who has access: **Anyone**
3. After editing `Code.gs`, deploy **New version**.
4. Refresh website with `Ctrl + F5`.
5. On phone, close Safari/Chrome and open again.

## Data layout in Google Sheet

The backend creates 3 tabs:

- `People` = name, nickname, role.
- `Pass_And_License` = each pass/license and expiry date.
- `Log` = record of setup/save/delete/email actions.

You can manually edit the Google Sheet if needed, but use the website when possible because it keeps the ID links correct.


## Fix note for “stuck on Opening...”

This fixed version uses JSONP script loading instead of the old hidden iframe/postMessage method.
If you updated from the previous version, do these 3 things:

1. Replace `app.js` on GitHub with this new `app.js`.
2. Replace Google Apps Script `Code.gs` with this new `apps-script/Code.gs`.
3. In Apps Script, click **Deploy > Manage deployments > Edit > New version > Deploy**.

After upload, hard-refresh the website. On phone, close Safari/Chrome and open again.
