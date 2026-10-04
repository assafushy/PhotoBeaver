# Facebook export connector

Imports the photos and videos from your Facebook "Download Your Information" archive (JSON format) into Photo Beaver.

## What it imports

- Photos and videos attached to your posts (`your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_*.json`), plus uncategorized photos and your videos when the export has them.
- Your albums (`your_facebook_activity/posts/album/*.json`). Each album becomes a Photo Beaver album. A photo that is both in a post and in an album is imported once, with the album attached.
- For each item: the capture time (the EXIF time when Facebook kept it, otherwise the upload time), the GPS location when present, and the caption (the photo description, otherwise the post text).
- The older export layout (`posts/your_posts_1.json` and `photos_and_videos/album/*.json`) also works.

Accented and non-Latin text is repaired automatically (Facebook writes it as `CafÃ©` instead of `Café`).

## Requesting your export

1. Open Facebook and go to **Accounts Center > Your information and permissions > Download your information**.
2. Choose **Download or transfer information**, pick your Facebook profile, and select **Specific types of information**.
3. Select **Posts** (and anything else you want to keep).
4. Choose **Download to device**, set **Format** to **JSON** and **Media quality** to **High**, and pick a date range.
5. Submit the request. Facebook emails you when the files are ready.

The HTML format is not supported. Request JSON.

## Adding the source

Download every part of the export into one folder, then add a **Facebook export** source in Photo Beaver and choose that folder.

You can use the .zip files exactly as downloaded. There is no need to unzip them: Photo Beaver reads them in place, across all parts. An extracted folder works too.

Every sync rescans the whole export. If you later download a newer export, point the source at the new folder or add it as a new source.

## Privacy

- The connector reads only the folder you choose.
- It makes no network requests. Nothing leaves your computer.
- Your files are never modified, moved or extracted.
