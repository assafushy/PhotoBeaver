# OneDrive connector

Indexes the photos and videos in your Microsoft OneDrive (personal, work or school) so they show up in your Photo Beaver library next to everything else.

## What it does

- Signs in with your Microsoft account in your browser. Photo Beaver never sees your password.
- Lists your whole OneDrive, or one folder you choose, with the Microsoft Graph `delta` API. The first sync reads everything; after that, each sync only fetches what changed since the last one, including deletions.
- Reads the details OneDrive already knows: capture time, GPS location, size, dimensions, video length and the file hash (`quickXorHash`). The hash lets Photo Beaver recognize the same photo when it also lives on your computer or in another service.
- Shows OneDrive's own thumbnails and downloads an original only when you open it or an enricher needs it.
- Checks for changes every hour by default (at most every 10 minutes). Each folder you add is a separate source, and you can add several accounts.

The connector only reads. It never uploads, moves or deletes anything in your OneDrive.

## Privacy

- The plugin only talks to Microsoft: `login.microsoftonline.com` for sign-in, `graph.microsoft.com` for the file list, and Microsoft's download hosts (`*.1drv.com`, `*.livefilestore.com`, `*.sharepoint.com`, `*.microsoftpersonalcontent.com` and `*.svc.ms`) for thumbnails and originals. Photo Beaver blocks every other host.
- It asks for read-only access to your files (`Files.Read`), your basic profile (`User.Read`, used to name the source after your account) and `offline_access` (so syncing keeps working without signing in again).
- Your sign-in tokens are stored encrypted in your operating system's keychain. Removing the source deletes them.
- Downloads use short-lived links from Microsoft and are sent without your access token.

## Setup: register your own Microsoft app

Microsoft requires every app that reads OneDrive to have an application (client) ID. Registering one is free and takes about five minutes. You only need to do it once; all your OneDrive sources share it.

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com) and sign in with any Microsoft account. A personal account works.
2. Go to **Identity** > **Applications** > **App registrations** and select **New registration**.
3. Fill in the form:
   - **Name:** anything you like, for example `Photo Beaver`.
   - **Supported account types:** **Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)**.
   - **Redirect URI:** leave it empty for now.
4. Select **Register**. You land on the app's **Overview** page.
5. Open **Authentication** and select **Add a platform** > **Mobile and desktop applications**.
6. In **Custom redirect URIs**, enter exactly:

   ```
   http://localhost/callback
   ```

   Microsoft ignores the port for `localhost` addresses, so this one entry covers whichever free port Photo Beaver picks. Select **Configure**.

7. Still on **Authentication**, under **Advanced settings**, set **Allow public client flows** to **Yes** and select **Save**.
8. Open **API permissions**. `User.Read` is already listed. Select **Add a permission** > **Microsoft Graph** > **Delegated permissions**, tick **Files.Read** and **offline_access**, and select **Add permissions**. You do not need admin consent for these.
9. Go back to **Overview** and copy the **Application (client) ID**. It looks like `1a2b3c4d-....`.
10. In Photo Beaver, open **Plugins** > **OneDrive** > **Settings**, paste the ID into **Application (client) ID** and save.

You do not need a client secret. Photo Beaver signs in as a desktop app with PKCE.

## Adding a source

1. Go to **Sources** > **Add source** > **OneDrive**.
2. Optionally type a folder, for example `Pictures/Camera Roll`. Leave it empty to index your whole OneDrive.
3. Select **Add**. Your browser opens the Microsoft sign-in page. Pick the account, approve the permissions, and return to Photo Beaver.

The source is named after your account, for example `OneDrive (ana@example.com)/Pictures`.

## Troubleshooting

- **"Set your Microsoft application ID in the plugin's settings first":** complete the setup steps above.
- **Microsoft says the redirect URI does not match:** check that the app has the **Mobile and desktop applications** platform with `http://localhost/callback` (not `127.0.0.1`, and not the **Web** platform).
- **"AADSTS50194" or "not configured as a multi-tenant application":** the app was registered for your organization only. Change **Supported account types** in the app's **Manifest** or register a new app with the option from step 3.
- **The source shows "Needs reconnecting":** your sign-in expired or was revoked. Select **Reconnect** and sign in again.
- **Work or school accounts:** some organizations require an administrator to approve new apps. Ask your IT team, or use a personal account.
