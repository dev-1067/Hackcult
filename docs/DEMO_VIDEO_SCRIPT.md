# LipiSetu — demo video script (≈ 3 min 30 s)

For the HackCult '26 Phase 1 submission: an **unlisted YouTube video** showing the working features.

## Before you record

1. Start the app: double-click `start.bat`, open **http://localhost:8000** in Chrome or Edge, full screen (F11), zoom 100%.
2. Use the **light theme** (sun icon, top right), which reads better on video.
3. Sign out if you are signed in (avatar → Sign out), so you start on the login page.
4. Have one manuscript photo ready on your desktop to upload. Any photo or scan of a Devanagari page works. A sample is `backend/seed/manuscripts/05-18th-century-yajurveda-manuscript-folio-page-1-raghunath-tem.jpg`.
5. Close notifications. Record the screen and your microphone:
   * **Windows:** Xbox Game Bar, `Win + Alt + R` to start and stop. The video lands in *Videos → Captures*.
   * Or use **Clipchamp** (built into Windows 11) → *Record* → *Screen and camera*. It can also trim the video afterwards.
6. Speak slowly. If you stumble, pause two seconds and repeat the sentence; cut it later.

## Script

| Time | On screen (do this) | Say this |
|---|---|---|
| 0:00 | Login page | "This is **LipiSetu**, *script bridge*. It reads India's handwritten manuscripts line by line, lets people verify them, and connects every text to the place it comes from. Everything here is running software." |
| 0:12 | Click **Contributor** under *Try a demo account* | "There are four roles: viewer, contributor, curator and admin. I'll start as a contributor." |
| 0:20 | Dashboard: point at the four stat cards and *Recognition quality* | "The dashboard shows the archive: ten real manuscripts from Wikimedia Commons, every line scored by how confident the recogniser is." |
| 0:32 | Sidebar → **Manuscripts** → **New manuscript**. Title `Demo folio`, Century `18`, Associated place `Rani ki Vav — Patan` → **Create manuscript** | "Let's add a new manuscript and link it to Rani ki Vav in Patan." |
| 0:48 | Drag your photo into **Add pages** → **Upload 1 file**. Wait for *Queued → Done* | "I upload a photo. It's queued for a background worker, so the website never freezes. Our own code cleans the page, corrects the tilt and finds every line, then a PP-OCR recogniser reads each one. A few seconds later it's done." |
| 1:10 | Click the page card → page viewer | "This is the page viewer. Each line is boxed and coloured: green is confident, amber needs a look, red needs a human." |
| 1:22 | Click a line in the right panel (the image zooms to it). Then click **IAST**, then **ગુજરાતી**, then **Original** | "Click a line and the image follows. One click shows the whole page in IAST romanisation or in Gujarati script." |
| 1:38 | Hover a red or amber line → pencil icon → fix a letter → **Suggest fix** | "OCR on handwritten Sanskrit will never be perfect, so we designed for people. I correct this line next to its image and send it for review." |
| 1:52 | Avatar → **Sign out** → click **Curator** | "Now I'm a curator." |
| 1:58 | Sidebar → **Review queue**. Point at the diff → **Approve** | "Curators see exactly what changed, character by character. When I approve, the line becomes *verified*. Verified lines become a training dataset for a better manuscript model." |
| 2:12 | Top search box: type `dharma` → Enter | "Search works across scripts. I type *dharma* in English and it finds धर्म in Devanagari, and still finds lines where the OCR dropped a letter." |
| 2:26 | Sidebar → **Heritage map**. Pick **IIT Gandhinagar** under *Start from*. Tick **Adalaj Stepwell**, **Dada Harir Stepwell** and **L. D. Institute of Indology** → **Plan trail** | "Every manuscript has a place. From IIT Gandhinagar I pick three sites. LipiSetu orders the stops for the shortest trip and draws the real road route: distance, driving time and visit time." |
| 2:48 | Click **Open trail** | "The trail is shareable and opens in Google Maps for navigation." |
| 2:55 | Sidebar → **OCR Lab**. Scroll through the results | "We measure ourselves. On aged synthetic pages with known text, our pipeline matches the strong off-the-shelf model at 3.4% character error, and it's 2.8 times better than the same recogniser without our clean-up. On real handwritten folios we read twice as much text, because stock detectors lose whole lines on pages without word spaces." |
| 3:20 | Sidebar → **Processing jobs**, then back to **Dashboard** | "Under the hood: a crash-safe job queue with retries, engine fallback, roles and an audit log, and 24 automated tests. The code is on GitHub at dev-1067/Hackcult. Thank you." |
| 3:32 | Stop recording | |

## Upload (unlisted)

1. Go to **studio.youtube.com** → *Create* → *Upload video* → choose the recording.
2. **Title:** `LipiSetu – Manuscript OCR, review & heritage trails | HackCult '26 (IIT Gandhinagar)`
3. **Description:** paste the line below, then the GitHub link.
   `LipiSetu reads handwritten Indian manuscripts line by line, lets people verify the text, searches across scripts and maps each manuscript to its heritage site. Track 2: Culture & Digital Heritage.`
4. *Audience:* **No, it's not made for kids.**
5. *Visibility:* **Unlisted** → *Save*. Copy the link for the Unstop submission.
