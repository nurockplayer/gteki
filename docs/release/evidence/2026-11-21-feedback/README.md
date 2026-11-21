# Feedback form frames (J14)

Captured 2026-11-21 19:51 JST using the actual Pages Function, a fresh in-memory
KV binding, Cloudflare's published passing Turnstile test keys and real
Siteverify. These are form samples, not a full journey acceptance reel.
The Vite session started at 1cc44a9 (the report's build SHA); it hot-reloaded the
widget loader correction df6cdd0 before the successful submission.

- Sample 3: [phone form](phone.jpg), 390×844, 5 touch points, guide,
  simT 32.7968 s, English notice and Turnstile widget.
- Sample 4: [desktop form](desktop.jpg), 1280×800, guide, simT 70.5499 s.
- [Submitted phone canvas](phone-submitted-canvas.jpg): nonblank, showing the
  cat, stairs and surrounding scene; JPEG 21,858 bytes.
- [Receipt](receipt.json): HTTP 201, one stored report, TTL 7,776,000 seconds
  (90 days), all requested game fields, no stored token and no IP marker.

The source URL included `token=SHOULD_NOT_BE_CAPTURED`; the report retained
only game parameters. The source fragment was removed by the app's URL update
before submission, and the payload builder/server independently strip fragments.
No report was sent by opening or typing. The only Send in this fresh mock
session stored exactly one report. QA held simulation after phone rendering;
report capture explicitly rendered and copied the phone canvas in the same task.
