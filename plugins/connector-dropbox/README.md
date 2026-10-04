# Dropbox connector

Indexes the photos and videos in your Dropbox so they show up in Photo Beaver next to your other sources. Files stay in Dropbox: Photo Beaver keeps metadata and thumbnails, and downloads an original only when you open or export it.

## What it does

- Lists your whole Dropbox, or one folder of it, including all subfolders.
- After the first scan, each sync asks Dropbox only for what changed since the last one: new, edited, moved and deleted files.
- Indexes images (JPEG, PNG, GIF, WebP, HEIC, TIFF, BMP and common RAW formats such as DNG, CR2, NEF, ARW, RAF, ORF and RW2) and videos (MP4, MOV, M4V, AVI, MKV, 3GP and WebM). Other files are ignored.
- Passes Dropbox's content hash to Photo Beaver, so the same photo on your computer and in Dropbox becomes one item with two locations.
- Uses Dropbox's own thumbnails, so a sync does not download your originals.
- You can add several Dropbox sources, for example one per account or one per folder.

## Privacy

- The plugin talks only to Dropbox (`www.dropbox.com`, `api.dropboxapi.com` and `content.dropboxapi.com`). Photo Beaver blocks any other network access.
- It asks Dropbox for read-only access. It cannot change, move or delete anything in your Dropbox.
- Your sign-in tokens are stored encrypted in your operating system's keychain, never in plain text.
- Nothing goes through a Photo Beaver server. You sign in with your own Dropbox app, created in the steps below.

## Set up your Dropbox app

Dropbox needs an app registration before Photo Beaver can sign in. It takes about five minutes and is free.

1. Go to the Dropbox App Console at https://www.dropbox.com/developers/apps and sign in.
2. Click **Create app**.
3. Under **Choose an API**, pick **Scoped access**.
4. Under **Choose the type of access you need**, pick **Full Dropbox**. **App folder** only sees a single folder that Dropbox creates for the app, so your existing photos would not be visible. The permissions in step 7 keep Full Dropbox access read-only.
5. Give the app a name, for example `Photo Beaver for <your name>` (app names must be unique across Dropbox), and click **Create app**.
6. On the **Settings** tab:
   1. Under **OAuth 2**, find **Redirect URIs** and add these three, one at a time, exactly as written:
      - `http://127.0.0.1:53682/callback`
      - `http://127.0.0.1:53683/callback`
      - `http://127.0.0.1:53684/callback`

      Photo Beaver uses the first of these ports that is free on your computer, so all three need to be registered.

   2. Set **Allow public clients (Implicit Grant & PKCE)** to **Allow**. Photo Beaver signs in with PKCE and never needs your app secret.
7. On the **Permissions** tab, tick exactly these scopes and click **Submit**:
   - `account_info.read`
   - `files.metadata.read`
   - `files.content.read`
8. Go back to the **Settings** tab and copy the **App key**. Do not copy the App secret; it is not needed.
9. In Photo Beaver, open **Plugins**, find **Dropbox**, click **Settings**, paste the App key and save.
10. Add a source: **Sources** > **Add source** > **Dropbox**. Optionally enter a folder (for example `/Photos`), or leave it empty for your whole Dropbox. Your browser opens the Dropbox sign-in page; approve access, then return to Photo Beaver.

A new app is in Dropbox's **Development** status, which allows your own account and up to 500 linked users. That is enough for personal use; you do not need to apply for production.

## Troubleshooting

- **"Set your Dropbox app key in the plugin's settings first"**: do step 9.
- **Dropbox shows "Invalid redirect_uri"**: check that all three redirect URIs from step 6 are registered exactly, including `http`, `127.0.0.1` and `/callback`.
- **The source shows "Needs reconnecting"**: the sign-in was revoked or expired. Click **Reconnect** on the source and sign in again.
- **Permission errors after changing scopes**: Dropbox applies scope changes only to new sign-ins. Click **Reconnect** on each Dropbox source.
