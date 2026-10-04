# Google Photos connector

Brings photos and videos from Google Photos into Photo Beaver. Google no longer lets apps read a whole Google Photos library through its API, so this plugin offers two ways in, and you choose one per source with **Import from**:

- **Picker** (`picker`): you pick photos in Google Photos in your browser, and Photo Beaver keeps a preview and the metadata of each one.
- **Takeout** (`takeout`): Photo Beaver reads a Google Takeout export of your library at full resolution, with albums, dates, captions and places.

You can add several sources, for example one Picker source and one Takeout source.

## Picker mode

- Each **Sync now** opens Google Photos in your browser. Choose the photos and videos you want, then click **Done**. Photo Beaver waits up to 30 minutes for you to finish. If you do not finish in time, the sync ends with nothing new.
- For each picked item, Photo Beaver stores its file name, type, size in pixels and the date it was taken, plus a preview of up to 1024 pixels on the longest side.
- Syncs only add items. Picking fewer items next time does not remove anything. To remove picked items, remove the source.
- Picker sources never sync on a schedule, because each sync needs you to pick in the browser.

### Limitation: previews only

Google's links to picked photos expire 60 minutes after you pick them and cannot be renewed. Photo Beaver therefore downloads a 1024 px preview right away and keeps it. That preview is what you see in Photo Beaver, also when you open the photo full screen or export it. The original file is not kept, and the Picker does not share the place a photo was taken. For full resolution and places, use Takeout mode.

## Takeout mode

- Reads a Google Takeout export of Google Photos, either extracted or as the downloaded `.zip` files. Nothing is extracted or copied: the zips are read in place.
- Reads the JSON file Google adds next to each photo for the date taken, the place (when there is one), the description and a link back to Google Photos. All known names of these files are recognized, including shortened names and numbered copies such as `IMG(1).jpg`.
- A photo that is in an album also appears in a "Photos from YYYY" folder in the export. Photo Beaver shows it once and lists it in the album.
- Every **Sync now** reads the whole export again. Photos that are no longer in the export are removed from this source. If the folder is missing (for example on an unplugged drive), the sync fails and nothing is removed.

### Get a Takeout export

1. Go to https://takeout.google.com and sign in.
2. Click **Deselect all**, then scroll to **Google Photos** and tick it. You can click **All photo albums included** to choose albums.
3. Click **Next step**.
4. Choose **Send download link via email**, **Export once**, file type **.zip** and any file size. Larger sizes mean fewer files to download.
5. Click **Create export**. Google emails you when it is ready, which can take hours or days for large libraries.
6. Download every part into one folder on your computer or an external drive. You do not need to extract them.
7. In Photo Beaver, go to **Sources** > **Add source** > **Google Photos**, set **Import from** to `takeout`, choose that folder as **Takeout folder**, and add the source. Then click **Sync now**.

To refresh later, replace the zips in the folder with a new export and click **Sync now**. Keep the whole export in the folder: photos missing from it are removed from the source.

## Privacy

- **Picker:** the plugin talks only to Google (`accounts.google.com`, `oauth2.googleapis.com`, `photospicker.googleapis.com`, `photos.google.com` and Google's image servers on `googleusercontent.com`). Photo Beaver blocks any other network access.
- **Picker:** it asks for read-only access to the items you pick and nothing else. It cannot see the rest of your library or change anything in Google Photos. Each picking session is deleted at Google when the sync ends.
- **Picker:** previews are stored in this plugin's private data folder on your computer. Your sign-in tokens are stored encrypted in your operating system's keychain.
- **Takeout:** no network access at all. The export is only read, never changed.
- Nothing goes through a Photo Beaver server. You sign in with your own Google Cloud OAuth client, created in the steps below.

## Set up your Google OAuth client (Picker mode only)

Picker mode needs your own OAuth client in Google Cloud. It is free and takes about ten minutes. Takeout mode does not need any of this.

1. Go to https://console.cloud.google.com and sign in.
2. Create a project: open the project list at the top, click **New project**, give it a name such as `Photo Beaver`, and click **Create**. Make sure the new project is selected.
3. Enable the API: go to **APIs & Services** > **Library**, search for **Photos Picker API**, open it and click **Enable**.
4. Configure the OAuth consent screen. In newer consoles this is **Google Auth Platform**; in older ones it is **APIs & Services** > **OAuth consent screen**.
   1. Click **Get started** (or **Configure consent screen**). Enter an app name such as `Photo Beaver` and your email as the support email.
   2. Under **Audience**, choose **External**.
   3. Enter your email as the contact email, accept the policy and click **Create**.
   4. Under **Audience** > **Test users**, click **Add users** and add the Google account whose photos you want to pick.
   5. Under **Data Access**, click **Add or remove scopes**. In **Manually add scopes**, paste `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`, click **Add to table**, then **Update** and **Save**.
5. Create the OAuth client: go to **Clients** (or **APIs & Services** > **Credentials** > **Create credentials** > **OAuth client ID**).
   1. Click **Create client** and choose **Desktop app** as the application type.
   2. Name it, for example `Photo Beaver desktop`, and click **Create**.
   3. Copy the **Client ID** and the **Client secret**. You do not need to register a redirect URI: desktop clients accept Photo Beaver's sign-in page on `http://127.0.0.1` with any port.
6. In Photo Beaver, go to **Plugins** > **Google Photos** > **Settings**, paste the client ID into **OAuth client ID** and the secret into **OAuth client secret**, and save. Google says the secret of a desktop client is not confidential, but keep it to yourself anyway.
7. Go to **Sources** > **Add source** > **Google Photos**, leave **Import from** on `picker` and add the source. Your browser opens Google's sign-in page.
   - Google warns that it has not verified the app. That is expected for your own client: click **Continue**.
   - Allow access to the photos and videos you select.
8. Click **Sync now** on the new source to pick your first photos.

### If Photo Beaver asks you to reconnect

While your consent screen is in **Testing**, Google ends sign-ins after 7 days, and the source then shows **Reconnect**. Click it and sign in again. To avoid this, publish the app under **Audience** > **Publish app**. You can keep using it without Google's verification; Google then shows the unverified-app warning at each sign-in.

## Troubleshooting

- **"Set your Google OAuth client ID and secret in the plugin's settings first"**: complete step 6 above.
- **Access blocked or "access_denied"**: the Google account you signed in with is not a test user (step 4.4), or the Photos Picker API is not enabled (step 3).
- **"No Google Photos export found"**: the chosen folder does not contain a Google Photos Takeout export. Choose the folder that holds the `takeout-*.zip` files or the extracted `Takeout` folder.
