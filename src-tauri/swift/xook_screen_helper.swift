import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers
import Vision

struct CaptureResult: Encodable {
    let ok: Bool
    let permissionGranted: Bool
    let accessibilityGranted: Bool
    let blockedSensitive: Bool
    let sensitiveReason: String?
    let appName: String
    let bundleId: String
    let windowTitle: String
    let captureMode: String
    let ocrText: String
    let axText: String
    let mergedText: String
    let imageDataUrl: String?
    let capturedAt: String
    let error: String?
}

struct WindowCandidate {
    let windowId: CGWindowID
    let pid: pid_t
    let appName: String
    let bundleId: String
    let title: String
    let bounds: CGRect
}

enum HelperError: Error, LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self {
        case .message(let msg):
            return msg
        }
    }
}

private let sensitiveBundleTokens: [String] = [
    "com.apple.keychainaccess",
    "com.apple.passwords",
    "com.agilebits.onepassword",
    "com.1password.",
    "com.bitwarden.",
    "com.dashlane.",
    "com.lastpass.",
    "org.keepassx.",
    "org.keepassxc.",
    "me.proton.pass",
    "in.sinew.enpass",
    "com.nordpass.",
    "com.authy.",
    "com.twilio.authy",
]

private let sensitiveAppNameTokens: [String] = [
    "1password",
    "bitwarden",
    "keychain access",
    "acceso a llaveros",
    "keepass",
    "lastpass",
    "dashlane",
    "proton pass",
    "enpass",
    "nordpass",
    "authy",
    "contraseñas",
    "passwords",
]

private let sensitiveTitleTokens: [String] = [
    "inprivate",
    "incógnito",
    "incognito",
    "private browsing",
    "navegación privada",
    "password manager",
    "gestor de contraseñas",
    "recovery phrase",
    "seed phrase",
    "llave privada",
]

private func isoNow() -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: Date())
}

private func printJsonAndExit(_ payload: CaptureResult, exitCode: Int32 = 0) -> Never {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    if let data = try? encoder.encode(payload), let text = String(data: data, encoding: .utf8) {
        print(text)
    } else {
        print("{\"ok\":false,\"permissionGranted\":false,\"accessibilityGranted\":false,\"blockedSensitive\":false,\"appName\":\"\",\"bundleId\":\"\",\"windowTitle\":\"\",\"captureMode\":\"display\",\"ocrText\":\"\",\"axText\":\"\",\"mergedText\":\"\",\"capturedAt\":\"\",\"error\":\"JSON encode error\"}")
    }
    fflush(stdout)
    exit(exitCode)
}

private func redactSecrets(_ raw: String) -> String {
    var text = raw
    let patterns: [(String, String)] = [
        ("sk-or-v1-[A-Za-z0-9_-]{16,}", "[CLAVE_OCULTA]"),
        ("sk-[A-Za-z0-9_-]{20,}", "[CLAVE_OCULTA]"),
        ("ghp_[A-Za-z0-9]{20,}", "[TOKEN_OCULTO]"),
        ("AIza[0-9A-Za-z_-]{20,}", "[API_KEY_OCULTA]"),
        ("Bearer\\s+[A-Za-z0-9._-]{20,}", "Bearer [TOKEN_OCULTO]"),
    ]
    for (pattern, replacement) in patterns {
        if let regex = try? NSRegularExpression(pattern: pattern, options: []) {
            let range = NSRange(location: 0, length: text.utf16.count)
            text = regex.stringByReplacingMatches(in: text, options: [], range: range, withTemplate: replacement)
        }
    }
    return text
}

private func detectSensitiveReason(appName: String, bundleId: String, windowTitle: String) -> String? {
    let b = bundleId.lowercased()
    let a = appName.lowercased()
    let t = windowTitle.lowercased()

    if sensitiveBundleTokens.contains(where: { b.contains($0) }) {
        return "App protegida (\(appName.isEmpty ? bundleId : appName))"
    }
    if sensitiveAppNameTokens.contains(where: { a == $0 || a.contains($0) }) {
        return "App de contraseñas o credenciales (\(appName))"
    }
    if sensitiveTitleTokens.contains(where: { t.contains($0) }) {
        return "Ventana privada o sensible (\(windowTitle))"
    }
    return nil
}

private func findTopVisibleNonXookWindow(excludeTitles: [String]) -> WindowCandidate? {
    let myPid = ProcessInfo.processInfo.processIdentifier
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        return nil
    }

    let loweredExcludes = excludeTitles.map { $0.lowercased() }

    for info in list {
        guard let pidNum = info[kCGWindowOwnerPID as String] as? Int32 else { continue }
        let layer = info[kCGWindowLayer as String] as? Int ?? 0
        if layer != 0 { continue }

        let alpha = info[kCGWindowAlpha as String] as? Double ?? 1.0
        if alpha <= 0.05 { continue }

        let title = (info[kCGWindowName as String] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let ownerName = (info[kCGWindowOwnerName as String] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let running = NSRunningApplication(processIdentifier: pidNum)
        let bundleId = running?.bundleIdentifier ?? ""

        if pidNum == myPid && loweredExcludes.contains(where: { !($0.isEmpty) && title.lowercased().contains($0) }) {
            continue
        }
        // Skip QuickBar or tiny helper overlays; also skip XOOK itself when picking active external context
        if pidNum == myPid {
            continue
        }
        if bundleId == "com.apple.controlcenter" || bundleId == "com.apple.notificationcenterui" || ownerName == "Window Server" || ownerName == "Dock" {
            continue
        }

        var bounds = CGRect.zero
        if let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
           let parsed = CGRect(dictionaryRepresentation: boundsDict as CFDictionary) {
            bounds = parsed
        }
        if bounds.width < 120 || bounds.height < 80 {
            continue
        }

        let wid = info[kCGWindowNumber as String] as? CGWindowID ?? kCGNullWindowID
        let appName = ownerName.isEmpty ? (running?.localizedName ?? "") : ownerName

        return WindowCandidate(
            windowId: wid,
            pid: pidNum,
            appName: appName,
            bundleId: bundleId,
            title: title,
            bounds: bounds
        )
    }

    return nil
}

private func extractAccessibilityText(pid: pid_t) -> (text: String, secureFocused: Bool) {
    guard AXIsProcessTrusted() else {
        return ("", false)
    }

    let appEl = AXUIElementCreateApplication(pid)
    var focusedWindowRef: CFTypeRef?
    let winErr = AXUIElementCopyAttributeValue(appEl, kAXFocusedWindowAttribute as CFString, &focusedWindowRef)
    let rootEl: AXUIElement
    if winErr == .success, let fw = focusedWindowRef {
        rootEl = (fw as! AXUIElement)
    } else {
        rootEl = appEl
    }

    var focusedElRef: CFTypeRef?
    if AXUIElementCopyAttributeValue(appEl, kAXFocusedUIElementAttribute as CFString, &focusedElRef) == .success,
       let fel = focusedElRef {
        var roleRef: CFTypeRef?
        let focusedAx = (fel as! AXUIElement)
        if AXUIElementCopyAttributeValue(focusedAx, kAXRoleAttribute as CFString, &roleRef) == .success,
           let role = roleRef as? String,
           role == "AXSecureTextField" {
            return ("", true)
        }
        var subroleRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(focusedAx, kAXSubroleAttribute as CFString, &subroleRef) == .success,
           let subrole = subroleRef as? String,
           subrole == "AXSecureTextField" {
            return ("", true)
        }
    }

    var chunks: [String] = []
    var seen = Set<String>()
    var visitedNodes = 0
    let maxNodes = 260
    var foundSecure = false

    func readStringAttr(_ el: AXUIElement, _ attr: CFString) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, attr, &value) == .success, let str = value as? String else {
            return nil
        }
        let cleaned = str.trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? nil : cleaned
    }

    func walk(_ el: AXUIElement, depth: Int) {
        if visitedNodes >= maxNodes || depth > 8 || foundSecure { return }
        visitedNodes += 1

        let role = readStringAttr(el, kAXRoleAttribute as CFString) ?? ""
        let subrole = readStringAttr(el, kAXSubroleAttribute as CFString) ?? ""
        if role == "AXSecureTextField" || subrole == "AXSecureTextField" {
            foundSecure = true
            return
        }

        for attr in [
            kAXTitleAttribute as CFString,
            kAXValueAttribute as CFString,
            kAXSelectedTextAttribute as CFString,
            kAXDescriptionAttribute as CFString,
        ] {
            if let text = readStringAttr(el, attr) {
                if text.count >= 2 && text.count <= 1500 && !seen.contains(text) {
                    seen.insert(text)
                    chunks.append(text)
                }
            }
        }

        var childrenRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &childrenRef) == .success,
           let children = childrenRef as? [AXUIElement] {
            for child in children.prefix(40) {
                walk(child, depth: depth + 1)
                if visitedNodes >= maxNodes || foundSecure { break }
            }
        }
    }

    walk(rootEl, depth: 0)
    if foundSecure {
        return ("", true)
    }

    let joined = chunks.joined(separator: "\n")
    return (String(joined.prefix(6000)), false)
}

private func runVisionOCR(on cgImage: CGImage) throws -> String {
    let request = VNRecognizeTextRequest()
    // En macOS recientes `.accurate` puede quedar bloqueado varios segundos en vistas densas;
    // `.fast` + corrección de idioma completa en ~0.35s y la vista RAM complementa detalles finos.
    request.recognitionLevel = .fast
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["es-MX", "es-ES", "en-US"]
    request.minimumTextHeight = 0.012

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try handler.perform([request])

    guard let observations = request.results, !observations.isEmpty else {
        return ""
    }

    struct LineItem {
        let midY: CGFloat
        let minX: CGFloat
        let text: String
    }

    let items: [LineItem] = observations.compactMap { obs in
        guard let top = obs.topCandidates(1).first else { return nil }
        let trimmed = top.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return LineItem(midY: obs.boundingBox.midY, minX: obs.boundingBox.minX, text: trimmed)
    }

    // Group observations into visual horizontal rows (Vision y=0 is bottom, y=1 is top)
    let sortedByY = items.sorted {
        if abs($0.midY - $1.midY) > 0.012 {
            return $0.midY > $1.midY
        }
        return $0.minX < $1.minX
    }

    var rows: [[LineItem]] = []
    for item in sortedByY {
        if let lastIdx = rows.indices.last,
           let refY = rows[lastIdx].first?.midY,
           abs(item.midY - refY) <= 0.012 {
            rows[lastIdx].append(item)
        } else {
            rows.append([item])
        }
    }

    let lines: [String] = rows.map { row in
        row.sorted { $0.minX < $1.minX }
            .map(\.text)
            .joined(separator: "  ")
    }

    return lines.joined(separator: "\n")
}

private func encodeCGImageToJpegDataUrl(_ cgImage: CGImage, maxDim: Int) -> String? {
    let srcW = cgImage.width
    let srcH = cgImage.height
    guard srcW > 0, srcH > 0 else { return nil }

    let clampedMax = max(320, min(maxDim, 1920))
    let scale = min(1.0, Double(clampedMax) / Double(max(srcW, srcH)))
    let dstW = max(1, Int((Double(srcW) * scale).rounded()))
    let dstH = max(1, Int((Double(srcH) * scale).rounded()))

    let finalImage: CGImage
    if dstW != srcW || dstH != srcH {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(
            data: nil,
            width: dstW,
            height: dstH,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else {
            return nil
        }
        ctx.interpolationQuality = .high
        ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: dstW, height: dstH))
        guard let resized = ctx.makeImage() else { return nil }
        finalImage = resized
    } else {
        finalImage = cgImage
    }

    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
        return nil
    }
    let props: [CFString: Any] = [
        kCGImageDestinationLossyCompressionQuality: 0.78
    ]
    CGImageDestinationAddImage(dest, finalImage, props as CFDictionary)
    guard CGImageDestinationFinalize(dest) else {
        return nil
    }

    let b64 = (data as Data).base64EncodedString()
    return "data:image/jpeg;base64,\(b64)"
}

private func mergeOcrAndAxText(ocr: String, ax: String, appName: String, windowTitle: String) -> String {
    var sections: [String] = []
    if !appName.isEmpty || !windowTitle.isEmpty {
        sections.append("App activa: \(appName.isEmpty ? "Desconocida" : appName)\(windowTitle.isEmpty ? "" : " — \(windowTitle)")")
    }
    if !ocr.isEmpty {
        sections.append("Texto visible en pantalla:\n\(ocr)")
    }
    if !ax.isEmpty {
        // Append AX lines not already covered verbatim by OCR
        let ocrLower = ocr.lowercased()
        let extraLines = ax
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { line in
                line.count >= 4 && !ocrLower.contains(line.lowercased())
            }
        if !extraLines.isEmpty {
            sections.append("Elementos adicionales de la interfaz:\n\(extraLines.prefix(40).joined(separator: "\n"))")
        }
    }
    return redactSecrets(sections.joined(separator: "\n\n"))
}

private struct CliOptions {
    var command: String = "check-permission"
    var mode: String = "display"
    var excludeTitles: [String] = ["Xox Quick Bar"]
    var includeImage: Bool = false
    var maxDim: Int = 1280
}

private func parseArgs() -> CliOptions {
    var opts = CliOptions()
    let args = Array(CommandLine.arguments.dropFirst())
    if let first = args.first, !first.hasPrefix("--") {
        opts.command = first
    }
    var i = opts.command == args.first ? 1 : 0
    while i < args.count {
        let arg = args[i]
        switch arg {
        case "--mode":
            if i + 1 < args.count {
                opts.mode = args[i + 1].lowercased() == "window" ? "window" : "display"
                i += 1
            }
        case "--exclude-title":
            if i + 1 < args.count {
                let title = args[i + 1]
                if !title.isEmpty && !opts.excludeTitles.contains(title) {
                    opts.excludeTitles.append(title)
                }
                i += 1
            }
        case "--include-image":
            if i + 1 < args.count {
                let v = args[i + 1].lowercased()
                opts.includeImage = (v == "1" || v == "true" || v == "yes")
                i += 1
            }
        case "--max-dim":
            if i + 1 < args.count, let parsed = Int(args[i + 1]) {
                opts.maxDim = max(320, min(parsed, 1920))
                i += 1
            }
        default:
            break
        }
        i += 1
    }
    return opts
}

@main
struct XookScreenHelperMain {
    static func main() async {
        let opts = parseArgs()
        let axTrusted = AXIsProcessTrusted()

        if opts.command == "check-permission" {
            let granted = CGPreflightScreenCaptureAccess()
            printJsonAndExit(
                CaptureResult(
                    ok: granted,
                    permissionGranted: granted,
                    accessibilityGranted: axTrusted,
                    blockedSensitive: false,
                    sensitiveReason: nil,
                    appName: "",
                    bundleId: "",
                    windowTitle: "",
                    captureMode: opts.mode,
                    ocrText: "",
                    axText: "",
                    mergedText: "",
                    imageDataUrl: nil,
                    capturedAt: isoNow(),
                    error: granted ? nil : "Permiso de Grabación de Pantalla pendiente"
                )
            )
        }

        if opts.command == "request-permission" {
            let granted = CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess()
            printJsonAndExit(
                CaptureResult(
                    ok: granted,
                    permissionGranted: granted,
                    accessibilityGranted: axTrusted,
                    blockedSensitive: false,
                    sensitiveReason: nil,
                    appName: "",
                    bundleId: "",
                    windowTitle: "",
                    captureMode: opts.mode,
                    ocrText: "",
                    axText: "",
                    mergedText: "",
                    imageDataUrl: nil,
                    capturedAt: isoNow(),
                    error: granted ? nil : "Autoriza Grabación de Pantalla para XOOK en Ajustes del Sistema > Privacidad y Seguridad."
                )
            )
        }

        // command == "capture"
        let hasPermission = CGPreflightScreenCaptureAccess()
        if !hasPermission {
            printJsonAndExit(
                CaptureResult(
                    ok: false,
                    permissionGranted: false,
                    accessibilityGranted: axTrusted,
                    blockedSensitive: false,
                    sensitiveReason: nil,
                    appName: "",
                    bundleId: "",
                    windowTitle: "",
                    captureMode: opts.mode,
                    ocrText: "",
                    axText: "",
                    mergedText: "",
                    imageDataUrl: nil,
                    capturedAt: isoNow(),
                    error: "Permiso de Grabación de Pantalla no concedido"
                )
            )
        }

        let topWindow = findTopVisibleNonXookWindow(excludeTitles: opts.excludeTitles)
        let activeAppName = topWindow?.appName ?? ""
        let activeBundleId = topWindow?.bundleId ?? ""
        let activeTitle = topWindow?.title ?? ""

        if let reason = detectSensitiveReason(appName: activeAppName, bundleId: activeBundleId, windowTitle: activeTitle) {
            printJsonAndExit(
                CaptureResult(
                    ok: true,
                    permissionGranted: true,
                    accessibilityGranted: axTrusted,
                    blockedSensitive: true,
                    sensitiveReason: reason,
                    appName: activeAppName,
                    bundleId: activeBundleId,
                    windowTitle: activeTitle,
                    captureMode: opts.mode,
                    ocrText: "",
                    axText: "",
                    mergedText: "",
                    imageDataUrl: nil,
                    capturedAt: isoNow(),
                    error: nil
                )
            )
        }

        var axText = ""
        if let pid = topWindow?.pid {
            let axRes = extractAccessibilityText(pid: pid)
            if axRes.secureFocused {
                printJsonAndExit(
                    CaptureResult(
                        ok: true,
                        permissionGranted: true,
                        accessibilityGranted: axTrusted,
                        blockedSensitive: true,
                        sensitiveReason: "Campo de contraseña o secreto enfocado",
                        appName: activeAppName,
                        bundleId: activeBundleId,
                        windowTitle: activeTitle,
                        captureMode: opts.mode,
                        ocrText: "",
                        axText: "",
                        mergedText: "",
                        imageDataUrl: nil,
                        capturedAt: isoNow(),
                        error: nil
                    )
                )
            }
            axText = redactSecrets(axRes.text)
        }

        do {
            guard #available(macOS 14.0, *) else {
                throw HelperError.message("La lectura de pantalla requiere macOS 14 o superior.")
            }

            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
            let myPid = ProcessInfo.processInfo.processIdentifier
            let loweredExcludes = opts.excludeTitles.map { $0.lowercased() }

            let excludedWindows = content.windows.filter { win in
                guard let owningPid = win.owningApplication?.processID else { return false }
                let titleLower = (win.title ?? "").lowercased()
                if owningPid == myPid && loweredExcludes.contains(where: { !$0.isEmpty && titleLower.contains($0) }) {
                    return true
                }
                return false
            }

            let filter: SCContentFilter
            let targetWidth: Int
            let targetHeight: Int
            var usedMode = opts.mode

            if opts.mode == "window",
               let top = topWindow,
               let scWin = content.windows.first(where: { $0.windowID == top.windowId }) {
                filter = SCContentFilter(desktopIndependentWindow: scWin)
                let scale = NSScreen.main?.backingScaleFactor ?? 2.0
                targetWidth = max(320, min(Int(scWin.frame.width * scale), 2400))
                targetHeight = max(240, min(Int(scWin.frame.height * scale), 1800))
            } else {
                usedMode = "display"
                let mainDisplay: SCDisplay?
                if let top = topWindow {
                    let center = CGPoint(x: top.bounds.midX, y: top.bounds.midY)
                    mainDisplay = content.displays.first(where: { $0.frame.contains(center) }) ?? content.displays.first
                } else {
                    mainDisplay = content.displays.first
                }
                guard let display = mainDisplay else {
                    throw HelperError.message("No se encontró ninguna pantalla activa para capturar.")
                }
                filter = SCContentFilter(display: display, excludingWindows: excludedWindows)
                let scale = NSScreen.main?.backingScaleFactor ?? 2.0
                let rawW = Int(Double(display.width) * scale)
                let rawH = Int(Double(display.height) * scale)
                let downscale = min(1.0, 1800.0 / Double(max(rawW, rawH)))
                targetWidth = max(640, Int((Double(rawW) * downscale).rounded()))
                targetHeight = max(480, Int((Double(rawH) * downscale).rounded()))
            }

            let config = SCStreamConfiguration()
            config.width = targetWidth
            config.height = targetHeight
            config.showsCursor = false
            config.scalesToFit = true

            let cgImage = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            let ocrRaw = try runVisionOCR(on: cgImage)
            let ocrText = redactSecrets(String(ocrRaw.prefix(12000)))
            let mergedText = mergeOcrAndAxText(ocr: ocrText, ax: axText, appName: activeAppName, windowTitle: activeTitle)
            let imageDataUrl = opts.includeImage ? encodeCGImageToJpegDataUrl(cgImage, maxDim: opts.maxDim) : nil

            printJsonAndExit(
                CaptureResult(
                    ok: true,
                    permissionGranted: true,
                    accessibilityGranted: axTrusted,
                    blockedSensitive: false,
                    sensitiveReason: nil,
                    appName: activeAppName,
                    bundleId: activeBundleId,
                    windowTitle: activeTitle,
                    captureMode: usedMode,
                    ocrText: ocrText,
                    axText: axText,
                    mergedText: mergedText,
                    imageDataUrl: imageDataUrl,
                    capturedAt: isoNow(),
                    error: nil
                )
            )
        } catch {
            let errText = error.localizedDescription
            let lowerErr = errText.lowercased()
            let tccDenied = lowerErr.contains("declined") || lowerErr.contains("tcc") || lowerErr.contains("not permitted") || lowerErr.contains("3801")
            printJsonAndExit(
                CaptureResult(
                    ok: false,
                    permissionGranted: !tccDenied && hasPermission,
                    accessibilityGranted: axTrusted,
                    blockedSensitive: false,
                    sensitiveReason: nil,
                    appName: activeAppName,
                    bundleId: activeBundleId,
                    windowTitle: activeTitle,
                    captureMode: opts.mode,
                    ocrText: "",
                    axText: axText,
                    mergedText: axText,
                    imageDataUrl: nil,
                    capturedAt: isoNow(),
                    error: tccDenied ? "Permiso de Grabación de Pantalla no concedido" : errText
                )
            )
        }
    }
}
