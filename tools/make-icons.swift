#!/usr/bin/env swift
// Renders the PWA icons — the same waveform-on-ink look as Skryba on macOS
// (style `b-waveform-atrament`), but full-bleed: iOS and Android apply their
// own mask to a home-screen icon, so drawing our own rounded corners would
// only get clipped twice.
//
//   swift tools/make-icons.swift        → icons/*.png
//
// Sizes: 180 (apple-touch-icon), 192 + 512 (manifest), 512 maskable (glyph
// pulled into the 80 % safe zone so an aggressive Android mask can't crop it).

import AppKit

_ = NSApplication.shared

func rgb(_ hex: UInt32) -> NSColor {
    NSColor(
        srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
        green: CGFloat((hex >> 8) & 0xFF) / 255,
        blue: CGFloat(hex & 0xFF) / 255,
        alpha: 1
    )
}

let top = rgb(0x33302C)
let bottom = rgb(0x14120F)
let ink = rgb(0xF2C4A8)

func draw(size: CGFloat, scale: CGFloat) -> Data {
    let pixels = Int(size)
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    )!
    rep.size = NSSize(width: size, height: size)

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    let rect = NSRect(x: 0, y: 0, width: size, height: size)
    NSGradient(colors: [top, bottom])!.draw(in: rect, angle: -90)
    NSGradient(colors: [NSColor(white: 1, alpha: 0.16), NSColor(white: 1, alpha: 0)])!
        .draw(in: NSRect(x: 0, y: size / 2, width: size, height: size / 2), angle: -90)

    let config = NSImage.SymbolConfiguration(pointSize: size * scale, weight: .medium)
    if let symbol = NSImage(systemSymbolName: "waveform", accessibilityDescription: nil)?
        .withSymbolConfiguration(config) {
        let tinted = NSImage(size: symbol.size, flipped: false) { bounds in
            ink.set()
            bounds.fill()
            symbol.draw(in: bounds, from: .zero, operation: .destinationIn, fraction: 1)
            return true
        }
        let box = NSRect(
            x: (size - tinted.size.width) / 2,
            y: (size - tinted.size.height) / 2,
            width: tinted.size.width,
            height: tinted.size.height
        )
        tinted.draw(in: box)
    } else {
        FileHandle.standardError.write(Data("warning: SF Symbol 'waveform' unavailable\n".utf8))
    }

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

let out = URL(fileURLWithPath: "icons", isDirectory: true)
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

let jobs: [(name: String, size: CGFloat, scale: CGFloat)] = [
    ("apple-touch-icon.png", 180, 0.60),
    ("icon-192.png", 192, 0.60),
    ("icon-512.png", 512, 0.60),
    ("icon-maskable-512.png", 512, 0.44),
]

for job in jobs {
    let data = draw(size: job.size, scale: job.scale)
    try data.write(to: out.appendingPathComponent(job.name))
    print("→ icons/\(job.name)  (\(Int(job.size))px, \(data.count / 1024) kB)")
}
