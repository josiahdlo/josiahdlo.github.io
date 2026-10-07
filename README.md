# josiahdlo.github.io

Personal portfolio site for Josiah Lo, built as plain HTML and CSS with no build step.

## Folder layout

```
index.html                  Home page: hero, highlights, experience, projects, skills, about, contact
projects/*.html             One case-study page per project
assets/css/style.css        All styling (colors and fonts are set at the top in :root)
assets/js/main.js           Mobile menu, image lightbox, table-of-contents highlight, scroll reveal
assets/img/                 Images, grouped by project (WebP)
assets/img/og.jpg           Link-preview image shown when the URL is shared on LinkedIn etc.
assets/Josiah_Lo_Resume.pdf The résumé that every "Résumé" button links to
favicon.svg                 Browser tab icon
```

## Preview locally

Double-click `index.html` to open it in a browser, or run a local server from this folder:

```
python -m http.server 8000
```

Then visit http://localhost:8000.

## Publish on GitHub Pages (one-time setup)

The site is served from the GitHub account `josiahdlo` at `https://josiahdlo.github.io`. That address
comes from the repository name, so the repo must be named exactly `josiahdlo.github.io`.

1. Create a new **public** repository named `josiahdlo.github.io` at https://github.com/new
   (leave it empty: no README, .gitignore, or license).
2. From this folder, push the code (the local repo is already initialized and committed):
   ```
   git remote add origin https://github.com/josiahdlo/josiahdlo.github.io.git
   git push -u origin main
   ```
3. In the repo, go to **Settings → Pages**. Under "Build and deployment", choose **Deploy from a branch**,
   set the branch to `main`, and the folder to `/ (root)`. The site goes live in a minute or two.

## Updating the site

- **New résumé:** replace `assets/Josiah_Lo_Resume.pdf` and keep the same file name. All buttons pick it up automatically.
- **Editing text:** edit the HTML directly. Each page has the same header and footer, so a change to
  navigation or contact links has to be made in all six HTML files.
- **Adding a project:**
  1. Copy an existing page in `projects/`, rename it, and replace the content and images.
  2. Add a card for it in the `projects` grid in `index.html`.
  3. Update the "Next project" link at the bottom of the neighbouring pages.
- **Images:** keep them around 1600 px wide and under roughly 300 KB. WebP works well; https://squoosh.app
  converts and compresses in the browser. Put them in `assets/img/<project>/`.
- **Then publish:** `git add . && git commit -m "Update" && git push`.
