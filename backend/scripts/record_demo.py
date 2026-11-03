"""Record the narrated demo video of a running LipiSetu (http://localhost:8000).

    pip install playwright edge-tts imageio-ffmpeg
    python -m scripts.record_demo            # writes ../../LipiSetu_Demo.mp4

Each scene has a voice-over line (Microsoft neural TTS) and the browser actions shown while it is
spoken. The browser (installed Microsoft Edge, driven by Playwright) is recorded, then the voice
clips are placed at each scene's start time and muxed into an H.264/AAC MP4.
"""

import asyncio
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import edge_tts
import httpx
import imageio_ffmpeg
from playwright.sync_api import Page, sync_playwright

BASE = "http://localhost:8000"
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT.parent / "LipiSetu_Demo.mp4"
SAMPLE = Path(__file__).resolve().parents[1] / "seed" / "manuscripts" / "05-18th-century-yajurveda-manuscript-folio-page-1-raghunath-tem.jpg"
VOICE = "en-IN-PrabhatNeural"
RATE = "-4%"
SIZE = {"width": 1920, "height": 1080}
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
DEMO_TITLE = "Demo folio: Yajurveda opening"

# A visible cursor (headless recordings have none) with a pulse on every click.
CURSOR_JS = """
(() => {
  if (window.__cursor) return; window.__cursor = true;
  const add = () => {
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transform:translate(-4px,-3px);transition:none';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.6L9.6 19z" fill="#1c1814" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    document.addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    document.addEventListener('mousedown', e => {
      const r = document.createElement('div');
      r.style.cssText = `position:fixed;left:${e.clientX-18}px;top:${e.clientY-18}px;width:36px;height:36px;border-radius:50%;border:3px solid #c4553a;z-index:2147483646;pointer-events:none;transition:all .45s ease-out;opacity:.9`;
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.8)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 500);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();
"""

CARD = """<!doctype html><html><head><meta charset="utf-8"><style>
body{{margin:0;height:100vh;display:flex;flex-direction:column;justify-content:center;padding:0 160px;
background:#1F1A15;color:#F3ECE0;font-family:'Segoe UI',Arial,sans-serif}}
.bar{{position:fixed;left:0;top:0;right:0;height:12px;background:#C4553A}}
.eyebrow{{font-size:30px;letter-spacing:4px;text-transform:uppercase;color:#E58A6D;font-weight:600}}
h1{{font-family:Georgia,serif;font-size:170px;margin:24px 0 0;font-weight:600}}
.dev{{font-family:'Nirmala UI',serif;font-size:80px;color:#E58A6D;margin-left:40px;font-weight:400}}
.line{{width:220px;height:8px;background:#C4553A;border-radius:4px;margin:36px 0}}
p{{font-family:Georgia,serif;font-size:46px;line-height:1.35;max-width:1450px;margin:0}}
.foot{{position:fixed;left:160px;bottom:80px;font-size:32px;color:#BDB2A3}}
</style></head><body><div class="bar"></div>
<div class="eyebrow">{eyebrow}</div><h1>LipiSetu<span class="dev">लिपि सेतु</span></h1>
<div class="line"></div><p>{body}</p><div class="foot">{foot}</div></body></html>"""


# --------------------------------------------------------------------------- helpers


def move_click(page: Page, locator, pause: float = 0.25) -> None:
    locator.scroll_into_view_if_needed()
    box = locator.bounding_box()
    if box:
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=22)
        time.sleep(pause)
    locator.click()


def hover(page: Page, locator, pause: float = 0.6) -> None:
    box = locator.bounding_box()
    if box:
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=22)
    time.sleep(pause)


def scroll_main(page: Page, dy: int) -> None:
    page.locator("main").evaluate(f"e => e.scrollBy({{top: {dy}, behavior: 'smooth'}})")
    time.sleep(1.2)


def goto(page: Page, path: str, settle: float = 1.2) -> None:
    page.goto(f"{BASE}{path}", wait_until="networkidle")
    time.sleep(settle)


def card(page: Page, eyebrow: str, body: str, foot: str) -> None:
    page.set_content(CARD.format(eyebrow=eyebrow, body=body, foot=foot))
    page.mouse.move(1880, 1060)


def sign_in(page: Page, role: str) -> None:
    goto(page, "/login", 0.8)
    move_click(page, page.get_by_role("button", name=role, exact=True))
    page.wait_for_url(f"{BASE}/", timeout=15000)
    time.sleep(1.0)


def sign_out(page: Page) -> None:
    move_click(page, page.get_by_role("button", name="Account menu"))
    time.sleep(0.4)
    move_click(page, page.get_by_role("menuitem", name="Sign out"))
    page.wait_for_url(f"{BASE}/login", timeout=15000)
    time.sleep(0.6)


# --------------------------------------------------------------------------- scenes


def s_intro(page: Page) -> None:
    card(
        page,
        "HackCult ’26 · IIT Gandhinagar · Track 2: Culture &amp; Digital Heritage",
        "Reading India’s handwritten manuscripts line by line, verifying them together, and leading you to the places they come from.",
        "Team Caffeinated Compilers · Vaibhav Dohare (Team Leader) &amp; Devaansh Sharma",
    )


def s_login(page: Page) -> None:
    goto(page, "/login", 1.5)
    hover(page, page.get_by_role("button", name="Admin", exact=True), 0.5)
    hover(page, page.get_by_role("button", name="Viewer", exact=True), 0.5)
    move_click(page, page.get_by_role("button", name="Contributor", exact=True))
    page.wait_for_url(f"{BASE}/", timeout=15000)


def s_dashboard(page: Page) -> None:
    time.sleep(1.0)
    hover(page, page.get_by_text("Lines read", exact=True), 1.2)
    hover(page, page.get_by_text("Recognition quality", exact=True), 1.5)
    hover(page, page.get_by_text("Recognition engines", exact=True), 1.5)
    scroll_main(page, 450)
    time.sleep(1.5)
    scroll_main(page, -450)


def s_new_manuscript(page: Page) -> None:
    goto(page, "/manuscripts", 1.5)
    move_click(page, page.get_by_role("button", name="New manuscript"))
    time.sleep(0.8)
    title = page.get_by_placeholder("e.g. Bhagavad Gītā with commentary")
    move_click(page, title)
    title.type(DEMO_TITLE, delay=45)
    century = page.get_by_placeholder("18")
    move_click(page, century)
    century.type("18", delay=80)
    place = page.locator("select").filter(has=page.locator("option", has_text="Rani ki Vav"))
    hover(page, place, 0.4)
    place.select_option(label="Rani ki Vav — Patan")
    time.sleep(0.8)
    move_click(page, page.get_by_role("button", name="Create manuscript"))
    page.wait_for_url(re.compile(r".*/manuscripts/[0-9a-f]+.*"), timeout=15000)
    time.sleep(1.0)


def s_upload(page: Page) -> None:
    hover(page, page.get_by_text("Drop page photos or a PDF here"), 0.8)
    page.set_input_files("input[type=file]", str(SAMPLE))
    time.sleep(1.0)
    move_click(page, page.get_by_role("button", name=re.compile(r"^Upload 1 file")))
    page.wait_for_function("document.body.innerText.includes('lines · ppocr')", timeout=90000)
    time.sleep(1.0)
    hover(page, page.locator('a[href^="/pages/"]').first, 1.0)


def s_viewer(page: Page) -> None:
    move_click(page, page.locator('a[href^="/pages/"]').first)
    page.wait_for_selector("li[data-line]", timeout=15000)
    time.sleep(2.0)
    lines = page.locator("li[data-line]")
    for i in (0, 2, 4):
        hover(page, lines.nth(i), 1.2)
    hover(page, page.get_by_text("≥85%"), 1.5)


def s_scripts(page: Page) -> None:
    lines = page.locator("li[data-line]")
    move_click(page, lines.nth(1))
    time.sleep(2.0)
    move_click(page, page.get_by_role("button", name="IAST", exact=True))
    time.sleep(2.5)
    move_click(page, page.get_by_role("button", name="ગુજરાતી", exact=True))
    time.sleep(2.5)
    # The image toolbar also has an "Original" (view) button; the script switcher is the last one.
    move_click(page, page.get_by_role("button", name="Original", exact=True).last)
    time.sleep(1.0)


def s_correct(page: Page) -> None:
    first = page.locator("li[data-line]").nth(0)
    move_click(page, first)
    time.sleep(0.8)
    move_click(page, first.get_by_role("button", name="Correct this line"))
    box = page.locator("textarea").first
    box.wait_for(timeout=10000)
    time.sleep(1.2)
    box.press("Control+A")
    box.type("ॐ श्रीगणेशाय नमः ॥ ॐ गणानां त्वा गणपतिं", delay=55)
    time.sleep(0.8)
    move_click(page, page.get_by_role("button", name="Suggest fix"))
    time.sleep(2.2)


def s_review(page: Page) -> None:
    sign_out(page)
    move_click(page, page.get_by_role("button", name="Curator", exact=True))
    # The app returns you to the page you were on before signing out.
    page.wait_for_function("location.pathname !== '/login'", timeout=15000)
    time.sleep(1.2)
    move_click(page, page.get_by_role("link", name=re.compile("Review queue")))
    page.wait_for_selector("text=Line image", timeout=15000)
    time.sleep(1.5)
    hover(page, page.locator("del, ins").first, 2.0)
    move_click(page, page.get_by_role("button", name="Approve", exact=True).first)
    time.sleep(2.5)


def s_search(page: Page) -> None:
    box = page.get_by_label("Search manuscripts")
    move_click(page, box)
    box.type("dharma", delay=110)
    time.sleep(0.4)
    box.press("Enter")
    page.wait_for_selector("mark", timeout=15000)
    time.sleep(2.0)
    hover(page, page.locator("mark").first, 2.0)
    scroll_main(page, 380)
    time.sleep(2.0)
    scroll_main(page, -380)


def s_map(page: Page) -> None:
    move_click(page, page.get_by_role("link", name="Heritage map"))
    time.sleep(3.0)
    start = page.get_by_label("Starting point")
    hover(page, start, 0.4)
    start.select_option(label="IIT Gandhinagar")
    time.sleep(2.5)
    for name in ("Adalaj Stepwell", "Dada Harir Stepwell", "L. D. Institute of Indology"):
        move_click(page, page.get_by_label(f"Add {name} to trail"))
        time.sleep(0.9)


def s_trail(page: Page) -> None:
    move_click(page, page.get_by_role("button", name=re.compile("^Plan trail from")))
    page.wait_for_selector("text=With visits", timeout=30000)
    time.sleep(3.5)
    move_click(page, page.get_by_role("button", name="Open trail"))
    page.wait_for_selector("text=Itinerary", timeout=15000)
    time.sleep(4.0)
    hover(page, page.get_by_role("button", name="Navigate"), 1.5)


def s_lab(page: Page) -> None:
    move_click(page, page.get_by_role("link", name="OCR Lab"))
    page.wait_for_selector("text=Character error rate", timeout=15000)
    time.sleep(2.5)
    hover(page, page.get_by_text("LipiSetu full pipeline"), 2.5)
    scroll_main(page, 700)
    time.sleep(3.0)
    scroll_main(page, 500)
    time.sleep(2.0)


def s_engineering(page: Page) -> None:
    move_click(page, page.get_by_role("link", name="Processing jobs"))
    time.sleep(3.5)
    move_click(page, page.get_by_role("link", name="Audit log"))
    time.sleep(3.5)


def s_outro(page: Page) -> None:
    card(
        page,
        "Thank you",
        "Open source on GitHub: <b>github.com/dev-1067/Hackcult</b><br>Run setup.bat once, then start.bat, and open localhost:8000.",
        "Team Caffeinated Compilers · Vaibhav Dohare (Team Leader) &amp; Devaansh Sharma",
    )


SCENES = [
    (s_intro, "Hello judges. We are team Caffeinated Compilers: Vaibhav Dohare, our team leader, and Devaansh Sharma. This is LipiSetu, which means script bridge. It reads India's handwritten manuscripts line by line, lets people verify the text together, makes every line searchable across scripts, and connects each manuscript to the heritage site it comes from. Everything you are about to see is the real, running application."),
    (s_login, "This is the sign in page. LipiSetu has four roles: viewer, contributor, curator and admin. For this demo, we sign in with one click as a contributor."),
    (s_dashboard, "The dashboard gives an overview of the archive. It holds ten real Sanskrit manuscripts from public collections, more than a hundred recognised lines, and every line carries a confidence score. Red lines need a human eye. On the right are the recognition engines, which fall back automatically if one fails."),
    (s_new_manuscript, "Let us add a new manuscript. We give it a title and a century, and link it to Rani ki Vav, the UNESCO world heritage stepwell in Patan, Gujarat."),
    (s_upload, "Now we upload a photograph of the page. The upload returns immediately, and the page is queued for a background worker, so the website never freezes. Our own pipeline crops the page, lifts faded ink, removes stains with Sauvola thresholding, corrects the tilt, and finds every line of text. Then a P P O C R version five recogniser reads each line. A few seconds later, it is done."),
    (s_viewer, "This is the page viewer. On the left is the cleaned folio, with every detected line boxed and coloured by confidence. Green is confident, amber needs a look, and red needs a human. On the right is the recognised text, with a confidence score for every line."),
    (s_scripts, "Clicking a line highlights it, and the image zooms to it. With one click, the whole page switches to I A S T romanisation, or to Gujarati script, which helps anyone who cannot read old Devanagari."),
    (s_correct, "Machine reading of handwritten Sanskrit will never be perfect, so LipiSetu is designed for people. A contributor corrects a line right next to its image, and sends the fix for review."),
    (s_review, "Now we sign in as a curator. The review queue shows exactly what changed, character by character. When the curator approves, the line becomes verified, it is indexed again for search, and it joins a training dataset that can fine tune a better model for manuscripts."),
    (s_search, "Search works across scripts. We type dharma in English, and LipiSetu finds dharma written in Devanagari, highlighted in every line. Because each line is also indexed in romanised form, using trigrams, it even finds lines where the machine dropped a letter."),
    (s_map, "Every manuscript belongs to a place. The heritage map shows twenty nine real heritage sites and manuscript libraries. We start from I I T Gandhinagar, and pick three places in Ahmedabad: Adalaj stepwell, Dada Harir stepwell, and the L D Institute of Indology."),
    (s_trail, "LipiSetu orders the stops for the shortest trip, using a nearest neighbour heuristic improved with two opt, and fetches the real road route. We get the distance, the driving time, and the total time including visits. The trail can be shared, and opened in Google Maps for navigation."),
    (s_lab, "We also measure ourselves. The O C R lab renders real Sanskrit and Hindi verses onto synthetic, aged pages, so the exact text is known. Our full pipeline reaches three point four percent character error, matching a strong off the shelf model, and it is two point eight times better than the same recogniser on the raw photo. On real handwritten folios, LipiSetu reads twice as much text, because stock detectors lose whole lines on pages without word spaces."),
    (s_engineering, "Under the hood, every page is processed in a crash safe job queue, with leases, retries and exponential backoff. Engines fall back automatically behind a circuit breaker. Every action is written to an audit log, and the project has twenty four automated tests."),
    (s_outro, "LipiSetu is open source on GitHub, at dev 1067, slash Hackcult. Thank you for watching, from team Caffeinated Compilers."),
]


# --------------------------------------------------------------------------- audio / video


def duration(path: Path) -> float:
    err = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)], capture_output=True, text=True).stderr
    h, m, s = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err).groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


async def synth(texts: list[str], folder: Path) -> list[Path]:
    paths = []
    for i, text in enumerate(texts):
        p = folder / f"v{i:02d}.mp3"
        await edge_tts.Communicate(text, VOICE, rate=RATE).save(str(p))
        paths.append(p)
    return paths


def cleanup() -> None:
    """Remove the manuscript and trail the demo created, so the archive stays as seeded."""
    for email in ("curator@lipisetu.in", "contributor@lipisetu.in"):
        tok = httpx.post(f"{BASE}/api/v1/auth/login", json={"email": email, "password": "Lipi@2026"}).json()["access_token"]
        h = {"Authorization": f"Bearer {tok}"}
        if email.startswith("curator"):
            for m in httpx.get(f"{BASE}/api/v1/manuscripts", params={"q": DEMO_TITLE}, headers=h).json()["items"]:
                if m["title"] == DEMO_TITLE:
                    httpx.delete(f"{BASE}/api/v1/manuscripts/{m['id']}", headers=h)
        else:
            trails = httpx.get(f"{BASE}/api/v1/trails", headers=h).json()["items"]
            for t in trails:
                if t["name"] == "My heritage trail":
                    httpx.delete(f"{BASE}/api/v1/trails/{t['id']}", headers=h)


def main() -> None:
    work = Path(tempfile.mkdtemp(prefix="lipisetu-demo-"))
    print("Synthesising voice-over...")
    clips = asyncio.run(synth([text for _, text in SCENES], work))
    lengths = [duration(c) for c in clips]
    print(f"Voice-over: {sum(lengths):.0f} s across {len(clips)} scenes")

    starts: list[float] = []
    try:
        record(lengths, starts, work, clips)
    finally:
        cleanup()
        shutil.rmtree(work, ignore_errors=True)
    print(f"Saved {OUT} ({duration(OUT):.0f} s)")


def record(lengths: list[float], starts: list[float], work: Path, clips: list[Path]) -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge")
        ctx = browser.new_context(
            viewport=SIZE, device_scale_factor=1, color_scheme="light",
            record_video_dir=str(work), record_video_size=SIZE,
        )
        ctx.add_init_script("localStorage.setItem('lipisetu-theme','light');")
        ctx.add_init_script(CURSOR_JS)
        page = ctx.new_page()
        t0 = time.monotonic()
        for (scene, _), length in zip(SCENES, lengths, strict=True):
            start = time.monotonic()
            starts.append(start - t0)
            print(f"  scene {scene.__name__} at {start - t0:6.1f}s (voice {length:.1f}s)")
            scene(page)
            remaining = length + 0.6 - (time.monotonic() - start)
            if remaining > 0:
                time.sleep(remaining)
        time.sleep(1.0)
        video_path = Path(page.video.path())
        ctx.close()
        browser.close()

    print("Mixing audio and encoding MP4...")
    inputs, filters = [], []
    for i, (clip, start) in enumerate(zip(clips, starts, strict=True)):
        inputs += ["-i", str(clip)]
        ms = int(start * 1000)
        filters.append(f"[{i}:a]adelay={ms}|{ms}[a{i}]")
    mix = "".join(f"[a{i}]" for i in range(len(clips)))
    voice = work / "voice.wav"
    subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", *inputs, "-filter_complex",
         ";".join(filters) + f";{mix}amix=inputs={len(clips)}:normalize=0,volume=1.0[out]", "-map", "[out]", str(voice)],
        check=True,
    )
    subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(video_path), "-i", str(voice),
         "-map", "0:v", "-map", "1:a", "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "medium",
         "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(OUT)],
        check=True,
    )


if __name__ == "__main__":
    main()
