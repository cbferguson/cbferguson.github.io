# Starter Site for GitHub Pages (No Jekyll)

This is a minimal static website you can deploy to GitHub Pages. It includes a `.nojekyll` file so GitHub won't try to build with Jekyll.

## How to use

1. Put your images (JPG/PNG/WebP) into the `images/` folder.
2. Edit `index.html` to reference your image filenames.
3. (Optional) Edit styles in `styles.css`.

## Deploy to GitHub Pages

**Deploy from branch (no Actions):**
1. Create a new GitHub repo and upload these files to the repository root.
2. Go to **Settings → Pages** → **Build and deployment** → set **Source** to **Deploy from a branch**.
3. Choose branch `main` and folder `/ (root)` → **Save**.
4. Your site will be served without Jekyll processing due to the `.nojekyll` file.

**Optional: GitHub Actions workflow**
If you prefer Actions, create `.github/workflows/pages.yml` with:
```yaml
name: Deploy static site to Pages
on:
  push:
    branches: [ "main" ]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```
Then enable Pages (Settings → Pages).

## Notes
- Make sure `index.html` is at the **repo root** (not inside a subfolder).
- Avoid folder names starting with `_` (e.g., `_images`) when not using `.nojekyll`—Jekyll would skip them.
- Filenames are **case-sensitive** on the web.
- If images don't show on your project page (not user site), remember the base path is `/<repo-name>/`.
