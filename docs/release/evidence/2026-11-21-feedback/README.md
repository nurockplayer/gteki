# Feedback form frames (J14)

Captured 2026-11-21 JST on code commit fe22052, local Vite with the actual Pages
Function and an in-memory KV binding. These are two feedback UI samples, not a
full journey acceptance reel.

- Sample 1: [desktop](desktop.jpg), 1488×1009, guide, simT 36.1494 s, English.
- Sample 2: [phone](phone.jpg), 390×844, touch points 5, guide, simT 79.9246 s,
  Traditional Chinese. QA held frames during resize, clearing the world buffer;
  this frame judges the form layout only. The saved report's canvas is rendered
  explicitly before capture.

Opening and typing left the mock store empty. One Send stored one report with
all requested fields and a 960×651 JPEG of 32,830 bytes. A phone Send within
60 seconds displayed the localized rate-limit message and kept one report.
The phone form did not overflow and its textarea maxlength was 1000.
