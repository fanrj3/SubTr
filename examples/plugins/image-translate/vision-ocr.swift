// Image Translate — Apple Vision OCR helper.
//
// Usage:  vision-ocr <image-path>   → JSON on stdout
//         vision-ocr --version      → "vision-ocr <version>"
//
// Output: {"version","imageWidth","imageHeight","blocks":[{text,confidence,xPct,yPct,wPct,hPct}]}
// Boxes are normalized 0–1 with origin TOP-LEFT (Vision returns bottom-left).
//
// Recognises Simplified Chinese + English with the accurate (neural) model and
// language correction. On-device only — the image never leaves the machine.

import Foundation
import AppKit
import Vision

let VERSION = "0.1.0"

func emitError(_ message: String) -> Never {
    let obj: [String: Any] = ["ok": false, "error": message]
    if let data = try? JSONSerialization.data(withJSONObject: obj) {
        FileHandle.standardError.write(data)
        FileHandle.standardError.write("\n".data(using: .utf8)!)
    }
    exit(1)
}

let args = CommandLine.arguments
if args.count >= 2 && (args[1] == "--version" || args[1] == "-v") {
    print("vision-ocr \(VERSION)")
    exit(0)
}
guard args.count >= 2 else { emitError("usage: vision-ocr <image-path>") }

let imagePath = args[1]
guard let image = NSImage(contentsOfFile: imagePath) else {
    emitError("cannot read image: \(imagePath)")
}
guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    emitError("cannot decode image")
}
let width = cgImage.width
let height = cgImage.height

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["zh-Hans", "en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    emitError("vision failed: \(error.localizedDescription)")
}

var blocks: [[String: Any]] = []
if let observations = request.results {
    for observation in observations {
        guard let candidate = observation.topCandidates(1).first else { continue }
        guard !candidate.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
        let box = observation.boundingBox // normalized, origin bottom-left
        let xPct = Double(box.origin.x)
        let yPct = 1.0 - Double(box.origin.y) - Double(box.size.height)
        let wPct = Double(box.size.width)
        let hPct = Double(box.size.height)
        blocks.append([
            "text": candidate.string,
            "confidence": Double(candidate.confidence),
            "xPct": xPct,
            "yPct": yPct,
            "wPct": wPct,
            "hPct": hPct,
        ])
    }
}

let out: [String: Any] = [
    "ok": true,
    "version": VERSION,
    "imageWidth": width,
    "imageHeight": height,
    "blocks": blocks,
]
let data = try! JSONSerialization.data(withJSONObject: out)
FileHandle.standardOutput.write(data)
