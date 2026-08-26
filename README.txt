# AA Embroidery PWA V1

Local-first catalog and price calculator.

## Rules
- Design number is the immediate design folder name only.
- Numbers in filenames do not determine the design number.
- Default rate: ₹10 per 1,000 billable stitches.
- Billable units: FLOOR(actual stitches / 1,000).
- A selected Sleeve/Hand component is calculated as quantity ×2.
- Scanner is read-only.
- The Excel catalog is not included in this repository.

## Test locally
Use a local web server. Do not rely on double-clicking `index.html` for PWA/service-worker testing.

PowerShell:
```powershell
cd C:\AA_Embroidery_App
py -m http.server 8000
```

Open:
`http://localhost:8000`

For phone testing on the same Wi-Fi, find the PC IPv4 address with:
```powershell
ipconfig
```
Then open:
`http://YOUR-PC-IP:8000`
on the phone.

## Important
The Excel engine is loaded from SheetJS CDN in V1, so the first Excel import/export test requires internet access. We can bundle/pin the library later for a more self-contained deployment.


V4 UI change: removed the in-app fake folder browser. Details now provides COPY PATH only for portable GitHub/mobile use.
