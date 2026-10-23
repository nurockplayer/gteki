// Lane F #342 Q5: on-device OCR of capture frames with Apple Vision (Japanese + English), no network.
// usage: swift tools/qa/recognition/ocr.swift <frame.png>... > ocr.json
// Prints one JSON array: per image its pixel size and every recognised text line with its confidence
// and box in image pixels (top-left origin). Line box height is the proxy for rendered text size.
import Foundation
import Vision
import ImageIO

struct Line: Encodable { let text: String; let confidence: Float; let x: Double; let y: Double; let w: Double; let h: Double }
struct Page: Encodable { let file: String; let width: Int; let height: Int; let lines: [Line]; let error: String? }

var pages: [Page] = []
for path in CommandLine.arguments.dropFirst() {
  let url = URL(fileURLWithPath: path)
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    pages.append(Page(file: path, width: 0, height: 0, lines: [], error: "unreadable image")); continue
  }
  let W = Double(img.width), H = Double(img.height)
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.recognitionLanguages = ["ja-JP", "en-US"]
  req.usesLanguageCorrection = false
  req.minimumTextHeight = 0.004
  var lines: [Line] = []
  var err: String? = nil
  do {
    try VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
    for o in req.results ?? [] {
      guard let c = o.topCandidates(1).first else { continue }
      let b = o.boundingBox // normalised, bottom-left origin
      lines.append(Line(text: c.string, confidence: c.confidence, x: b.minX * W, y: (1 - b.maxY) * H, w: b.width * W, h: b.height * H))
    }
  } catch { err = String(describing: error) }
  pages.append(Page(file: path, width: img.width, height: img.height, lines: lines, error: err))
}
let enc = JSONEncoder()
enc.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
FileHandle.standardOutput.write(try enc.encode(pages))
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
