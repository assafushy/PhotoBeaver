# Instagram export connector

Imports the photos and videos from your Instagram data download (JSON format) into Photo Beaver.

## What it imports

- Your posts, including every photo and video in a carousel (`your_instagram_activity/media/posts_*.json`).
- Your stories (`stories.json`), reels (`reels.json`) and profile photos (`profile_photos.json`).
- For each item: the capture time (the EXIF time when Instagram kept it, otherwise the post time), the GPS location when present, and the caption.
- Older export layouts (`content/posts_1.json` and the `media/` folder) also work.
- Recently deleted content is skipped.

Accented and non-Latin text is repaired automatically (Instagram writes it as `CafÃ©` instead of `Café`).

## Requesting your export

1. Open Instagram and go to **Accounts Center > Your information and permissions > Download your information**.
2. Choose **Download or transfer information**, pick your Instagram account, and select **All available information** or at least **Content**.
3. Choose **Download to device**, set **Format** to **JSON** and **Media quality** to **High**, and pick a date range.
4. Submit the request. Instagram emails you when the files are ready.

The HTML format is not supported. Request JSON.

## Adding the source

Download every part of the export into one folder, then add an **Instagram export** source in Photo Beaver and choose that folder.

You can use the .zip files exactly as downloaded. There is no need to unzip them: Photo Beaver reads them in place, across all parts. An extracted folder works too.

Every sync rescans the whole export. If you later download a newer export, point the source at the new folder or add it as a new source.

## Privacy

- The connector reads only the folder you choose.
- It makes no network requests. Nothing leaves your computer.
- Your files are never modified, moved or extracted.
