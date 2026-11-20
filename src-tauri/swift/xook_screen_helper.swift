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

struct WindowRectJson: Encodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct WindowListItemJson: Encodable {
    let windowId: UInt32
    let pid: Int32
    let appName: String
    let bundleId: String
    let title: String
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct WindowListOutputJson: Encodable {
    let ok: Bool
    let accessibilityGranted: Bool
    let windows: [WindowListItemJson]
    let error: String?
}

struct WindowTileOutputJson: Encodable {
    let ok: Bool
    let accessibilityGranted: Bool
    let pid: Int32?
    let windowId: UInt32?
    let appName: String
    let bundleId: String
    let windowTitle: String
    let prevFrame: WindowRectJson?
    let appliedFrame: WindowRectJson?
    let error: String?
}

struct AccessibilityOutputJson: Encodable {
    let ok: Bool
    let accessibilityGranted: Bool
    let error: String?
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

private func printEncodedJsonAndExit<T: Encodable>(_ payload: T, exitCode: Int32 = 0) -> Never {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    if let data = try? encoder.encode(payload), let text = String(data: data, encoding: .utf8) {
        print(text)
    } else {
        print("{\"ok\":false,\"error\":\"JSON encode error\"}")
    }
    fflush(stdout)
    exit(exitCode)
}

private func printJsonAndExit(_ payload: CaptureResult, exitCode: Int32 = 0) -> Never {
    printEncodedJsonAndExit(payload, exitCode: exitCode)
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

private let excludedSystemBundleIds: Set<String> = [
    "com.xook.app",
    "com.apple.controlcenter",
    "com.apple.notificationcenterui",
    "com.apple.dock",
    "com.apple.Spotlight",
    "com.apple.WindowManager",
    "com.apple.loginwindow",
    "com.apple.screencaptureui",
    "com.apple.systemuiserver",
    "com.apple.wallpaper.agent",
]

private let excludedSystemOwnerNames: Set<String> = [
    "xook",
    "window server",
    "dock",
    "control center",
    "notification center",
    "spotlight",
    "wallpaper",
    "systemuiserver",
    "windowmanager",
]

private func isXookOrSystemWindow(
    pid: pid_t,
    bundleId: String,
    ownerName: String,
    title: String,
    excludePids: Set<pid_t>,
    excludeTitles: [String]
) -> Bool {
    let myPid = ProcessInfo.processInfo.processIdentifier
    if pid == myPid || excludePids.contains(pid) {
        return true
    }
    let lowerBundle = bundleId.lowercased()
    let lowerOwner = ownerName.lowercased()
    let lowerTitle = title.lowercased()
    if excludedSystemBundleIds.contains(lowerBundle) || lowerBundle == "com.xook.app" {
        return true
    }
    if excludedSystemOwnerNames.contains(lowerOwner) || lowerOwner == "xook" {
        return true
    }
    if lowerTitle == "xox quick bar" {
        return true
    }
    let isXookOwner = lowerBundle == "com.xook.app" || lowerOwner == "xook"
    if isXookOwner && excludeTitles.contains(where: { !$0.isEmpty && lowerTitle == $0.lowercased() }) {
        return true
    }
    return false
}

private func listVisibleNonXookWindows(
    excludePids: Set<pid_t>,
    excludeTitles: [String],
    forTiling: Bool
) -> [WindowCandidate] {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        return []
    }

    let minW: CGFloat = forTiling ? 180 : 120
    let minH: CGFloat = forTiling ? 120 : 80
    var results: [WindowCandidate] = []
    var seenWindowIds = Set<CGWindowID>()

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

        if isXookOrSystemWindow(
            pid: pidNum,
            bundleId: bundleId,
            ownerName: ownerName,
            title: title,
            excludePids: excludePids,
            excludeTitles: excludeTitles
        ) {
            continue
        }

        if forTiling {
            guard let app = running, app.activationPolicy == .regular else { continue }
        }

        var bounds = CGRect.zero
        if let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
           let parsed = CGRect(dictionaryRepresentation: boundsDict as CFDictionary) {
            bounds = parsed
        }
        if bounds.width < minW || bounds.height < minH {
            continue
        }

        let wid = info[kCGWindowNumber as String] as? CGWindowID ?? kCGNullWindowID
        if wid != kCGNullWindowID && seenWindowIds.contains(wid) {
            continue
        }
        if wid != kCGNullWindowID {
            seenWindowIds.insert(wid)
        }

        let appName = ownerName.isEmpty ? (running?.localizedName ?? "") : ownerName
        if appName.isEmpty { continue }

        results.append(
            WindowCandidate(
                windowId: wid,
                pid: pidNum,
                appName: appName,
                bundleId: bundleId,
                title: title,
                bounds: bounds
            )
        )
    }

    return results
}

private func findTopVisibleNonXookWindow(excludePids: Set<pid_t>, excludeTitles: [String]) -> WindowCandidate? {
    return listVisibleNonXookWindows(excludePids: excludePids, excludeTitles: excludeTitles, forTiling: false).first
}

private func axReadString(_ el: AXUIElement, _ attr: CFString) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr, &value) == .success, let str = value as? String else {
        return nil
    }
    return str.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func axReadBool(_ el: AXUIElement, _ attr: CFString) -> Bool? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr, &value) == .success else { return nil }
    if let b = value as? Bool { return b }
    if let n = value as? NSNumber { return n.boolValue }
    return nil
}

private func axReadPoint(_ el: AXUIElement, _ attr: CFString) -> CGPoint? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr, &value) == .success, let val = value else {
        return nil
    }
    guard CFGetTypeID(val) == AXValueGetTypeID() else { return nil }
    let axVal = val as! AXValue
    var pt = CGPoint.zero
    return AXValueGetValue(axVal, .cgPoint, &pt) ? pt : nil
}

private func axReadSize(_ el: AXUIElement, _ attr: CFString) -> CGSize? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr, &value) == .success, let val = value else {
        return nil
    }
    guard CFGetTypeID(val) == AXValueGetTypeID() else { return nil }
    let axVal = val as! AXValue
    var sz = CGSize.zero
    return AXValueGetValue(axVal, .cgSize, &sz) ? sz : nil
}

private func axReadFrame(_ el: AXUIElement) -> CGRect? {
    guard let pos = axReadPoint(el, kAXPositionAttribute as CFString),
          let size = axReadSize(el, kAXSizeAttribute as CFString) else {
        return nil
    }
    return CGRect(origin: pos, size: size)
}

private func axSetPosition(_ el: AXUIElement, _ point: CGPoint) -> AXError {
    var pt = point
    guard let axVal = AXValueCreate(.cgPoint, &pt) else { return .failure }
    return AXUIElementSetAttributeValue(el, kAXPositionAttribute as CFString, axVal)
}

private func axSetSize(_ el: AXUIElement, _ size: CGSize) -> AXError {
    var sz = size
    guard let axVal = AXValueCreate(.cgSize, &sz) else { return .failure }
    return AXUIElementSetAttributeValue(el, kAXSizeAttribute as CFString, axVal)
}

private func findBestAxWindow(
    appEl: AXUIElement,
    preferredTitle: String?,
    preferredBounds: CGRect?
) -> AXUIElement? {
    var candidates: [AXUIElement] = []

    var windowsRef: CFTypeRef?
    if AXUIElementCopyAttributeValue(appEl, kAXWindowsAttribute as CFString, &windowsRef) == .success,
       let wins = windowsRef as? [AXUIElement] {
        candidates.append(contentsOf: wins)
    }

    if candidates.isEmpty {
        var focusedRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(appEl, kAXFocusedWindowAttribute as CFString, &focusedRef) == .success,
           let fw = focusedRef {
            candidates.append(fw as! AXUIElement)
        }
    }
    if candidates.isEmpty {
        var mainRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(appEl, kAXMainWindowAttribute as CFString, &mainRef) == .success,
           let mw = mainRef {
            candidates.append(mw as! AXUIElement)
        }
    }

    guard !candidates.isEmpty else { return nil }

    let wantedTitle = (preferredTitle ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    var bestEl: AXUIElement?
    var bestScore = Double.infinity

    for win in candidates {
        let subrole = axReadString(win, kAXSubroleAttribute as CFString) ?? ""
        let minimized = axReadBool(win, kAXMinimizedAttribute as CFString) ?? false
        let frame = axReadFrame(win)
        if let f = frame, (f.width < 120 || f.height < 80) && !minimized {
            continue
        }

        var score = 0.0
        if !subrole.isEmpty && subrole != (kAXStandardWindowSubrole as String) {
            score += 400.0
        }
        if minimized {
            score += 250.0
        }
        if !wantedTitle.isEmpty {
            let axTitle = axReadString(win, kAXTitleAttribute as CFString) ?? ""
            if axTitle == wantedTitle {
                score -= 200.0
            } else if !axTitle.isEmpty && (axTitle.contains(wantedTitle) || wantedTitle.contains(axTitle)) {
                score -= 80.0
            }
        }
        if let target = preferredBounds, let f = frame {
            let dist = abs(f.origin.x - target.origin.x)
                + abs(f.origin.y - target.origin.y)
                + abs(f.size.width - target.size.width)
                + abs(f.size.height - target.size.height)
            score += Double(dist) * 0.15
        }
        if score < bestScore {
            bestScore = score
            bestEl = win
        }
    }

    return bestEl ?? candidates.first
}

private func applyAxWindowFrame(
    pid: pid_t,
    preferredTitle: String?,
    preferredBounds: CGRect?,
    targetRect: CGRect,
    raiseAndActivate: Bool
) -> (ok: Bool, prevFrame: CGRect?, appliedFrame: CGRect?, title: String, error: String?) {
    let appEl = AXUIElementCreateApplication(pid)
    guard let axWin = findBestAxWindow(
        appEl: appEl,
        preferredTitle: preferredTitle,
        preferredBounds: preferredBounds
    ) else {
        return (false, nil, nil, preferredTitle ?? "", "No se encontró una ventana redimensionable en la app seleccionada.")
    }

    let resolvedTitle = axReadString(axWin, kAXTitleAttribute as CFString) ?? (preferredTitle ?? "")

    if axReadBool(axWin, "AXFullScreen" as CFString) == true {
        return (
            false,
            axReadFrame(axWin),
            nil,
            resolvedTitle,
            "La ventana acompañante está en pantalla completa nativa de macOS. Sal de pantalla completa para dividirla con Xook."
        )
    }

    let prevFrame = axReadFrame(axWin) ?? preferredBounds

    if axReadBool(axWin, kAXMinimizedAttribute as CFString) == true {
        _ = AXUIElementSetAttributeValue(axWin, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
    }

    // Desactiva temporalmente AXEnhancedUserInterface (Electron/Chromium) para evitar rezago al acoplar
    let enhancedAttr = "AXEnhancedUserInterface" as CFString
    let wasEnhanced = axReadBool(appEl, enhancedAttr) == true
    if wasEnhanced {
        _ = AXUIElementSetAttributeValue(appEl, enhancedAttr, kCFBooleanFalse)
    }

    let pos = CGPoint(x: targetRect.origin.x.rounded(), y: targetRect.origin.y.rounded())
    let size = CGSize(width: max(200.0, targetRect.size.width.rounded()), height: max(200.0, targetRect.size.height.rounded()))

    let errPos1 = axSetPosition(axWin, pos)
    let errSize1 = axSetSize(axWin, size)
    let errPos2 = axSetPosition(axWin, pos)
    _ = axSetSize(axWin, size)

    if wasEnhanced {
        _ = AXUIElementSetAttributeValue(appEl, enhancedAttr, kCFBooleanTrue)
    }

    if raiseAndActivate {
        _ = AXUIElementPerformAction(axWin, kAXRaiseAction as CFString)
        if let app = NSRunningApplication(processIdentifier: pid) {
            app.activate(options: [])
        }
    }

    let appliedFrame = axReadFrame(axWin)
    let ok = (errPos1 == .success || errPos2 == .success) && errSize1 == .success
    if !ok {
        return (
            false,
            prevFrame,
            appliedFrame,
            resolvedTitle,
            "Esta app no permitió ajustar su posición/tamaño automáticamente."
        )
    }

    return (true, prevFrame, appliedFrame, resolvedTitle, nil)
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
    var excludePids: Set<pid_t> = []
    var includeImage: Bool = false
    var maxDim: Int = 1280
    var targetPid: pid_t? = nil
    var targetWindowId: CGWindowID? = nil
    var targetTitle: String? = nil
    var rectX: Double? = nil
    var rectY: Double? = nil
    var rectW: Double? = nil
    var rectH: Double? = nil
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
        case "--exclude-pid":
            if i + 1 < args.count, let parsed = Int32(args[i + 1]) {
                opts.excludePids.insert(parsed)
                i += 1
            }
        case "--target-pid":
            if i + 1 < args.count, let parsed = Int32(args[i + 1]) {
                opts.targetPid = parsed
                i += 1
            }
        case "--target-window-id":
            if i + 1 < args.count, let parsed = UInt32(args[i + 1]) {
                opts.targetWindowId = parsed
                i += 1
            }
        case "--target-title":
            if i + 1 < args.count {
                opts.targetTitle = args[i + 1]
                i += 1
            }
        case "--x":
            if i + 1 < args.count, let parsed = Double(args[i + 1]) {
                opts.rectX = parsed
                i += 1
            }
        case "--y":
            if i + 1 < args.count, let parsed = Double(args[i + 1]) {
                opts.rectY = parsed
                i += 1
            }
        case "--w":
            if i + 1 < args.count, let parsed = Double(args[i + 1]) {
                opts.rectW = parsed
                i += 1
            }
        case "--h":
            if i + 1 < args.count, let parsed = Double(args[i + 1]) {
                opts.rectH = parsed
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

        if opts.command == "request-accessibility" {
            let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
            let trusted = AXIsProcessTrustedWithOptions([promptKey: true] as CFDictionary)
            printEncodedJsonAndExit(
                AccessibilityOutputJson(
                    ok: trusted,
                    accessibilityGranted: trusted,
                    error: trusted ? nil : "Autoriza a XOOK en Ajustes del Sistema > Privacidad y Seguridad > Accesibilidad."
                )
            )
        }

        if opts.command == "list-windows" {
            let visible = listVisibleNonXookWindows(
                excludePids: opts.excludePids,
                excludeTitles: opts.excludeTitles,
                forTiling: true
            )
            // Mantén hasta 12 ventanas visibles (priorizando orden Z frontal -> trasera)
            let items = visible.prefix(12).map { win in
                WindowListItemJson(
                    windowId: win.windowId,
                    pid: win.pid,
                    appName: win.appName,
                    bundleId: win.bundleId,
                    title: win.title,
                    x: Double(win.bounds.origin.x),
                    y: Double(win.bounds.origin.y),
                    width: Double(win.bounds.size.width),
                    height: Double(win.bounds.size.height)
                )
            }
            printEncodedJsonAndExit(
                WindowListOutputJson(
                    ok: true,
                    accessibilityGranted: axTrusted,
                    windows: items,
                    error: nil
                )
            )
        }

        if opts.command == "tile-window" {
            guard axTrusted else {
                printEncodedJsonAndExit(
                    WindowTileOutputJson(
                        ok: false,
                        accessibilityGranted: false,
                        pid: opts.targetPid,
                        windowId: opts.targetWindowId,
                        appName: "",
                        bundleId: "",
                        windowTitle: "",
                        prevFrame: nil,
                        appliedFrame: nil,
                        error: "Permiso de Accesibilidad pendiente para ajustar automáticamente la otra ventana."
                    )
                )
            }

            guard let rx = opts.rectX, let ry = opts.rectY, let rw = opts.rectW, let rh = opts.rectH else {
                printEncodedJsonAndExit(
                    WindowTileOutputJson(
                        ok: false,
                        accessibilityGranted: true,
                        pid: opts.targetPid,
                        windowId: opts.targetWindowId,
                        appName: "",
                        bundleId: "",
                        windowTitle: "",
                        prevFrame: nil,
                        appliedFrame: nil,
                        error: "Coordenadas de división incompletas."
                    )
                )
            }

            let visible = listVisibleNonXookWindows(
                excludePids: opts.excludePids,
                excludeTitles: opts.excludeTitles,
                forTiling: true
            )

            let chosen: WindowCandidate? = {
                if let wantedWid = opts.targetWindowId,
                   let match = visible.first(where: { $0.windowId == wantedWid }) {
                    return match
                }
                if let wantedPid = opts.targetPid,
                   let match = visible.first(where: { $0.pid == wantedPid }) {
                    return match
                }
                return visible.first
            }()

            let resolvedPid = chosen?.pid ?? opts.targetPid
            guard let pid = resolvedPid else {
                printEncodedJsonAndExit(
                    WindowTileOutputJson(
                        ok: false,
                        accessibilityGranted: true,
                        pid: nil,
                        windowId: nil,
                        appName: "",
                        bundleId: "",
                        windowTitle: "",
                        prevFrame: nil,
                        appliedFrame: nil,
                        error: "No hay otra ventana abierta visible para acoplar junto a Xook."
                    )
                )
            }

            let running = NSRunningApplication(processIdentifier: pid)
            let appName = chosen?.appName ?? running?.localizedName ?? "Aplicación"
            let bundleId = chosen?.bundleId ?? running?.bundleIdentifier ?? ""
            let preferredTitle = chosen?.title.isEmpty == false ? chosen?.title : opts.targetTitle
            let targetRect = CGRect(x: rx, y: ry, width: rw, height: rh)

            let outcome = applyAxWindowFrame(
                pid: pid,
                preferredTitle: preferredTitle,
                preferredBounds: chosen?.bounds,
                targetRect: targetRect,
                raiseAndActivate: true
            )

            printEncodedJsonAndExit(
                WindowTileOutputJson(
                    ok: outcome.ok,
                    accessibilityGranted: true,
                    pid: pid,
                    windowId: chosen?.windowId ?? opts.targetWindowId,
                    appName: appName,
                    bundleId: bundleId,
                    windowTitle: outcome.title,
                    prevFrame: outcome.prevFrame.map {
                        WindowRectJson(
                            x: Double($0.origin.x),
                            y: Double($0.origin.y),
                            width: Double($0.size.width),
                            height: Double($0.size.height)
                        )
                    },
                    appliedFrame: outcome.appliedFrame.map {
                        WindowRectJson(
                            x: Double($0.origin.x),
                            y: Double($0.origin.y),
                            width: Double($0.size.width),
                            height: Double($0.size.height)
                        )
                    },
                    error: outcome.error
                )
            )
        }

        if opts.command == "restore-window" {
            guard axTrusted else {
                printEncodedJsonAndExit(
                    WindowTileOutputJson(
                        ok: false,
                        accessibilityGranted: false,
                        pid: opts.targetPid,
                        windowId: opts.targetWindowId,
                        appName: "",
                        bundleId: "",
                        windowTitle: "",
                        prevFrame: nil,
                        appliedFrame: nil,
                        error: "Permiso de Accesibilidad no concedido."
                    )
                )
            }
            guard let pid = opts.targetPid,
                  let rx = opts.rectX,
                  let ry = opts.rectY,
                  let rw = opts.rectW,
                  let rh = opts.rectH else {
                printEncodedJsonAndExit(
                    WindowTileOutputJson(
                        ok: false,
                        accessibilityGranted: true,
                        pid: opts.targetPid,
                        windowId: opts.targetWindowId,
                        appName: "",
                        bundleId: "",
                        windowTitle: "",
                        prevFrame: nil,
                        appliedFrame: nil,
                        error: "Datos insuficientes para restaurar la ventana acompañante."
                    )
                )
            }

            let running = NSRunningApplication(processIdentifier: pid)
            if running == nil {
                printEncodedJsonAndExit(
                    WindowTileOutputJson(
                        ok: false,
                        accessibilityGranted: true,
                        pid: pid,
                        windowId: opts.targetWindowId,
                        appName: "",
                        bundleId: "",
                        windowTitle: "",
                        prevFrame: nil,
                        appliedFrame: nil,
                        error: "La app acompañante ya no está abierta."
                    )
                )
            }

            let outcome = applyAxWindowFrame(
                pid: pid,
                preferredTitle: opts.targetTitle,
                preferredBounds: nil,
                targetRect: CGRect(x: rx, y: ry, width: rw, height: rh),
                raiseAndActivate: false
            )

            printEncodedJsonAndExit(
                WindowTileOutputJson(
                    ok: outcome.ok,
                    accessibilityGranted: true,
                    pid: pid,
                    windowId: opts.targetWindowId,
                    appName: running?.localizedName ?? "",
                    bundleId: running?.bundleIdentifier ?? "",
                    windowTitle: outcome.title,
                    prevFrame: nil,
                    appliedFrame: outcome.appliedFrame.map {
                        WindowRectJson(
                            x: Double($0.origin.x),
                            y: Double($0.origin.y),
                            width: Double($0.size.width),
                            height: Double($0.size.height)
                        )
                    },
                    error: outcome.error
                )
            )
        }

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

        let topWindow = findTopVisibleNonXookWindow(excludePids: opts.excludePids, excludeTitles: opts.excludeTitles)
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

            let excludedWindows = content.windows.filter { win in
                guard let owningApp = win.owningApplication else { return false }
                let owningPid = owningApp.processID
                let bundleLower = owningApp.bundleIdentifier.lowercased()
                let appLower = owningApp.applicationName.lowercased()
                let titleLower = (win.title ?? "").lowercased()
                if owningPid == myPid || opts.excludePids.contains(owningPid) {
                    return true
                }
                if bundleLower == "com.xook.app" || appLower == "xook" {
                    return true
                }
                if titleLower == "xox quick bar" {
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
