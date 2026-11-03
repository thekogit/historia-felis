# Historia Felis — Deployment Guide

*Historia Felis* is a self-contained static site. It needs no backend server, no database and no runtime secrets. The site is built locally (`npm run build` writes `index.html`), and only three things are published: `index.html`, `assets/` and `_headers`.

The build tooling (`scripts/`), working data (`data/backups/`, `data/*_candidates.json`) and caches (`.cache/`) are local-only and listed in `.gitignore`.

---

## 1. Quick Local Hosting

### Node.js (Recommended)
```bash
npm run serve
# or
npx serve .
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### Python (Alternative)
```bash
python -m http.server 8080
```
Open [http://localhost:8080](http://localhost:8080) in your browser.

### Caddy (Instant HTTPS locally)
```bash
caddy file-server --listen :8080
```

---

## 2. Free Static Web Hosts

### GitHub Pages
1. Push the repository to GitHub (public repo; Pages on a free plan needs a public repo).
2. In the repository go to **Settings > Pages**, and under **Build and deployment > Source** choose **GitHub Actions**.
3. Every push to `main` or `master` runs `.github/workflows/deploy.yml`, which copies `index.html`, `assets/` and `_headers` into `dist/` and publishes only that. The workflow doesn't build anything, so commit a fresh `index.html`.
4. Day to day, one command validates, builds, commits and pushes:
   ```bash
   npm run deploy                          # message: "Update site YYYY-MM-DD"
   npm run deploy -- "Add 12 Steinlen prints"
   ```
   It stops before committing if validation fails.
   **Editing the catalogue publishes automatically.** With the editor running (`npm run edit`), every Save / Delete / Restore rebuilds `index.html`, then commits `index.html`, `data/` and `assets/` and pushes. Saves within a few seconds of each other become one commit. If a push fails (offline), the commit is kept and pushed with the next save. The editor server only accepts requests from `localhost` (Host and Origin are checked), so other websites can't trigger a push. To turn it off, put `AUTO_PUBLISH=0` in `.env`.
5. The site will be live at `https://<username>.github.io/<repo-name>/`.

Note: GitHub Pages ignores `_headers` (that file is for Cloudflare Pages / Netlify). Pages sets its own caching (about 10 minutes), which is fine for this site.

### Cloudflare Pages
1. Connect your GitHub repository to Cloudflare Pages.
2. Set **Build command**: *(leave empty)*.
3. Set **Build output directory**: `/`.
4. Deploy. Cloudflare's global edge network will cache and serve `index.html` worldwide with sub-50ms latency.

### Netlify
1. Drag and drop the project folder directly onto [app.netlify.com/drop](https://app.netlify.com/drop) or link the Git repository.
2. Publish directory: `.`
3. Build command: *(none needed)*.

### Vercel
```bash
npm install -g vercel
vercel
```
Accept the defaults (root directory, no framework).

---

## 3. Dedicated Web Servers

### Nginx Configuration
Place this in your `/etc/nginx/sites-available/art-cats`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name cats.example.org;

    root /var/www/art_cats;
    index index.html;

    # Gzip / Brotli Compression
    gzip on;
    gzip_types text/html text/css application/javascript application/json image/svg+xml;
    gzip_min_length 256;

    # Security Headers
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com https://upload.wikimedia.org https://cdnjs.cloudflare.com;" always;

    # Hash Routing Fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache HTML with ETag
    location = /index.html {
        add_header Cache-Control "no-cache, must-revalidate";
    }
}
```

### Caddyfile
```caddy
cats.example.org {
    root * /var/www/art_cats
    file_server
    encode gzip zstd
    try_files {path} /index.html
}
```

### Docker
A production-ready minimal Docker container based on `nginx:alpine`:

```dockerfile
FROM nginx:alpine
COPY index.html /usr/share/nginx/html/index.html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

To build and run:
```bash
docker build -t historia-felis .
docker run -d -p 8080:80 historia-felis
```

---

## 4. Privacy & Security Checklist

-- **Zero Private Information Leaks**: No local file paths, personal usernames, private IP addresses, or internal tokens exist in `index.html` or dataset files.
-- **Content Security**: All imagery is sourced from verified public domain institutional archives (Wikimedia Commons, museum collections).
-- **Client-Side Autonomy**: All data is stored in static JSON blocks embedded directly in `index.html`. No user tracking, no third-party analytics cookies, and no tracking pixels are embedded.
