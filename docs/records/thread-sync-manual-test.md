# Thread sync: manual test with a real Google account

Two assumptions behind thread sync cannot be checked without a real Google account and two computers
(see the [plan](../../implementations/mobile-sync-programme/implementation.md), P4b and P5b, and the
[architecture](../architecture/README.md#thread-sync)):

1. **Cross-computer visibility under `drive.file`.** Two Tenon installations signed in with the same OAuth
   client and the same Google account see each other's files.
2. **Listing freshness.** A Drive listing made right after a file is created shows that file, which the
   store's emulated conditional write relies on.

Everything else was tested against local fakes of Google's sign-in and of Drive v3.

## What you need

- A Google account you are happy to test with.
- A Google Cloud project with the **Google Drive API** enabled
  (APIs & Services › Library › Google Drive API › Enable).
- An OAuth consent screen (External, in Testing, with your account added as a test user) and an OAuth
  client of type **Desktop app** (APIs & Services › Credentials › Create credentials › OAuth client ID).
  Note its client ID (ends in `.apps.googleusercontent.com`) and client secret. Google treats a desktop
  client's secret as not secret, but do not post it anywhere.
- Two computers with Tenon Workbench (call them A and B). Windows and macOS both work; a thread started on
  Windows cannot yet be continued on macOS (deferred work).

## Steps

1. **A: set up.** Settings › Sync. Paste the client ID and secret, Save. Sign in: your browser opens
   Google's page; choose the account and allow "See, edit, create and delete only the specific Google Drive
   files you use with this app". The page says "Tenon is signed in to Google Drive". Back in Tenon the row
   reads "Signed in to Google Drive".
2. **A: key.** Create a key. Write the recovery phrase down (it is shown once), then I saved it.
3. **A: turn on.** Turn on Sync threads. The line at the top reads "Sync is on."
4. **A: a thread.** Start a thread in any Project and let it finish one reply. Within a few seconds of the
   thread going idle it is uploaded. In Settings › Sync › Stored threads, Refresh: the thread shows with
   "This computer · Up to date".
5. **Drive web page.** Open drive.google.com. A folder "Tenon Workbench Threads" exists in My Drive with
   files named `Tenon sync - threads - ses_… - manifest` and `… - segment-…`. Their content is not readable.
   **Record:** the folder and files exist (yes/no).
6. **B: set up with the same client.** Settings › Sync on B: the same client ID and secret, Sign in with
   the same account, then Enter the recovery phrase from step 2 and Use phrase. Turn on Sync threads.
7. **B: list (assumption 1).** Stored threads, Refresh. **Record:** does A's thread appear, owned by A's
   computer name, "Not on this computer"? If it does not appear, record what the page shows; this is the
   `drive.file` visibility assumption failing.
8. **B: continue here.** Continue here on that thread, pick a folder on B. The thread opens in B's
   sidebar under that folder. Send one more prompt on B and let it finish.
9. **A: see the hand-over.** On A, Refresh: the thread is now owned by B and shows "Newer copy stored".
10. **Freshness (assumption 2).** On A, Continue here on the same thread, and within two seconds on B send
    another prompt so B pushes at the same time. **Record:** whether either computer later shows "Copies
    differ" for that thread. "Copies differ" means two writes both reported success, which is the freshness
    assumption failing in a race; each computer keeps its own copy and nothing is lost.
11. **Sign out.** On A, Sign out. In your Google account's security page (Third-party access) the client
    no longer has access.

## Report back

| Step | Expected | Seen |
| --- | --- | --- |
| 5 | Folder and two kinds of files, content unreadable | |
| 7 | A's thread listed on B | |
| 9 | Owner B, "Newer copy stored" on A | |
| 10 | No "Copies differ" in normal use; in the race either works or shows "Copies differ" | |
| 11 | Access removed | |
