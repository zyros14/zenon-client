## CurseForge proxy (Vercel)

This is a tiny proxy so the launcher can access CurseForge **without shipping an API key**.

### Deploy (free)
1. Create a Vercel account (free).
2. Import this repo into Vercel.
3. Set **Project → Settings → Environment Variables**:
   - `CURSEFORGE_API_KEY` = your CurseForge API key
4. Deploy.

### Endpoints
- `/api/search`
- `/api/files`
- `/api/download-url`
- `/api/file`

### Notes
- The launcher should be configured with `CURSEFORGE_PROXY_BASE` set to your deployed base URL (e.g. `https://your-app.vercel.app`).

