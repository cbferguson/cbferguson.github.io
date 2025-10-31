# Starter Site for GitHub Pages

This is a minimal static website you can deploy to GitHub Pages.

## How to use

1. Put your images (JPG/PNG/WebP) into the `images/` folder.
2. Edit `index.html`:
   - Replace the `<img src="images/example*.ext">` entries with your own filenames (e.g., `images/vacation1.jpg`).
   - Update titles and text as needed.
3. (Optional) Edit styles in `styles.css`.

## Deploy to GitHub Pages

**Option A: Web upload (no command line)**
1. Go to GitHub → New repository → name it like `my-site` → set Public (recommended for Pages) → Create.
2. Click **Add file → Upload files** and drag the contents of this folder (`index.html`, `styles.css`, `script.js`, and the `images` folder) into GitHub. Commit the changes.
3. Go to **Settings → Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**. Choose branch `main` and folder `/ (root)`. Click **Save**.
4. Wait for the green check in **Actions**. Your site will appear at the URL shown in **Settings → Pages** (typically `https://<your-username>.github.io/<repo-name>/`).

**Option B: Command line (git)**
```bash
# In a terminal, from the parent directory of this folder:
git init
git add .
git commit -m "Initial site"
# Create the remote repo first on GitHub, then:
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```
Then enable Pages the same way as Option A (Settings → Pages).

## Notes
- Filenames are **case-sensitive** on the web. `IMG_001.jpg` is different from `img_001.jpg`.
- Prefer hyphens in filenames: `my-photo.jpg` instead of `my photo.jpg`.
- Keep image sizes reasonable (e.g., < 2MB) for faster loading.
- If you add **new** images, just commit/push again or upload them via GitHub's web UI.
