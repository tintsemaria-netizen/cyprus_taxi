Task 007 — IL-Yas branding and responsive booking UI

Status: TODO
Repository: https://github.com/tintsemaria-netizen/cyprus_taxi
Existing beta: https://cyprustaxi.ackedberryes.store

Implement this task in the current project. Save it under root Tasks/ and update its index. Read repository instructions and current task/handoff status first. Preserve current work, including Tasks 005 and 006; inspect whether their fixes already exist before changing them.

Brand decision

The application is now named exactly IL-Yas: uppercase I, uppercase L, hyphen, uppercase Y, lowercase a and s. Never use Il-Yas, IL-YAS or ILYas as the visible brand name.
Use the attached generated logo and desktop/mobile presentation as visual references. They are design concepts, not screenshots of a deployed implementation. If the images were not attached, follow this written specification and report that visual matching was limited.

Create a clean reusable vector logo with a lime Y-shaped branching road/navigation symbol and an off-white IL-Yas wordmark. The uppercase L must have a clearly visible horizontal foot. Use flat fills and crisp edges; do not reproduce raster glow, noise or rendering artifacts. Supply standalone symbol, horizontal lockup, light-background variant, favicon and app icons. Keep the symbol recognizable at small sizes. Use a suitable already licensed project font or properly licensed open font; outline wordmark paths where needed for portable assets.
Palette: charcoal #10191C, secondary surface #1D282D, lime #C8FF46, off-white text. Use dark text on lime buttons. Keep text contrast, readable labels and visible focus states.

Rename and integrate

Audit user-facing references to Taxi Cyprus / Cyprus Taxi and update the product name across the public booking page, tracking page, staff/driver/dispatcher shells, login, page titles, metadata, social previews, loading/empty/error states and existing install manifest. Centralize brand configuration and use a shared accessible Logo component.
Keep the existing repository name, domain, API paths, database names, cookies, secrets and infrastructure identifiers stable. This is a visible rebrand, not a migration. Do not replace historical audit documentation blindly. Keep factual Cyprus service-area descriptions and beta/demo notices accurate.
Generate and wire actual favicon and manifest icon files where supported, including standard 192/512px and Apple touch icon sizes. Respect safe padding for maskable icons. Do not claim native Android/iOS applications or offline booking support merely because icons or a manifest exist.

Responsive UI reference

Desktop: compact branded header; readable booking panel on the left; broad interactive map on the right. Preserve the real form fields and existing supported functionality. Main actions use lime; secondary controls use dark outlined surfaces. Keep Now/Schedule, ride type and passenger controls easy to scan.
Mobile: compact header, useful map preview and a booking sheet with comfortable spacing. The full form must remain accessible by scrolling; do not remove name, phone, comments, passenger count or scheduling fields because the concept image shows only the upper part. Avoid horizontal overflow and oversized branding.

Task 006 behavior remains mandatory: clicking Set pickup on map or Set destination on map hides/collapses the form and exposes a full-viewport interactive map, with compact Back, My location, selected address/coordinate fallback and Confirm controls. Restore all form state after confirmation/cancel. Request browser geolocation appropriately; handle denial and delayed results without overwriting manual selection. Distinguish the device position from the selected pin. Follow Task 006 in full.

Use real existing map components, not the generated screenshot as a background. The concept's roads, route, satellite imagery, labels, slogans, domain and decorative objects are illustrative. Do not adopt the pictured domain, invent service claims, hardcode the illustrated route, enable a paid map provider, or add unsupported navigation/features just to mimic the image. Keep current map attribution. Route lines and ETA must come from an implemented provider or remain explicitly demo/unavailable under the existing mode rules. No fake live cars, prices or arrival promises.

Verification and delivery

Check desktop 1440px and mobile 360/390px layouts, header/logo readability, long addresses, full-form scrolling and full-screen selection.

Verify browser tab favicon/title, tracking branding and staff login branding. Check manifest assets load without 404s if a manifest exists.

Run relevant existing tests, type checking and production build. Use focused checks for actual behavioral changes; avoid tests that only repeat static branding strings.

Capture real implementation screenshots: desktop booking, mobile booking, mobile full-screen picker. Clearly identify any physical-device checks that could not be performed.

Commit and push through your authorized access, then deploy only the existing Taxi Cyprus beta service using its established procedure. Preserve secrets and unrelated services.

Report commit SHA, deployed version, exact checks/results and any blocked work. Update current handoff/test documents and task index. Do not claim deployment or test success without evidence.