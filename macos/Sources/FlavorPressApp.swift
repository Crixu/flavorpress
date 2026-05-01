import SwiftUI
import AppKit
import WebKit
import ServiceManagement
import Network

enum FlavorPressConfig {
    static let urlDefaultsKey = "FlavorPressURL"
    static let bundleId = "com.flavorpress.desktop"
    static let appSupportFolder = "FlavorPress"
    static let logsFolder = "FlavorPress"
    static let serverBootTimeout: TimeInterval = 30
    static let serverPollInterval: TimeInterval = 0.25
}

@main
struct FlavorPressApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var server = EmbeddedServer.shared

    var body: some Scene {
        WindowGroup("FlavorPress", id: "main") {
            RootView()
                .environmentObject(server)
                .frame(minWidth: 900, minHeight: 600)
        }
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .appInfo) {
                Button("About FlavorPress") {
                    NSApplication.shared.orderFrontStandardAboutPanel(nil)
                }
            }
            CommandGroup(after: .appSettings) {
                Divider()
                LaunchAtLoginToggle()
                Button("Reload") { NotificationCenter.default.post(name: .flavorPressReload, object: nil) }
                    .keyboardShortcut("r", modifiers: [.command])
                Button("Open Settings") {
                    NotificationCenter.default.post(name: .flavorPressNavigate, object: "/settings")
                }
                    .keyboardShortcut(",", modifiers: [.command])
                Button("Reveal Data Folder") { revealDataFolder() }
            }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        EmbeddedServer.shared.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        EmbeddedServer.shared.stop()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag, let window = NSApp.windows.first {
            window.makeKeyAndOrderFront(nil)
        }
        return true
    }
}

extension Notification.Name {
    static let flavorPressReload = Notification.Name("FlavorPressReload")
    static let flavorPressNavigate = Notification.Name("FlavorPressNavigate")
}

@MainActor
final class EmbeddedServer: ObservableObject {
    static let shared = EmbeddedServer()

    enum Status: Equatable {
        case idle
        case starting
        case ready(URL)
        case failed(String)
    }

    @Published private(set) var status: Status = .idle
    private var process: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var logFileHandle: FileHandle?

    func start() {
        guard case .idle = status else { return }
        status = .starting

        if let externalURL = UserDefaults.standard.string(forKey: FlavorPressConfig.urlDefaultsKey),
           let url = URL(string: externalURL) {
            // External server override (e.g. dev pointing at npm run dev).
            // We don't manage its lifecycle; just use it.
            status = .ready(url)
            return
        }

        Task.detached(priority: .userInitiated) {
            await self.spawn()
        }
    }

    func stop() {
        process?.terminate()
        process = nil
        try? logFileHandle?.close()
        logFileHandle = nil
    }

    private func spawn() async {
        let resources = Bundle.main.resourceURL ?? URL(fileURLWithPath: ".")
        let nodeBin = resources.appendingPathComponent("node")
        let serverDir = resources.appendingPathComponent("server")
        let serverEntry = serverDir.appendingPathComponent("server.js")

        guard FileManager.default.fileExists(atPath: nodeBin.path),
              FileManager.default.fileExists(atPath: serverEntry.path) else {
            await MainActor.run {
                self.status = .failed("Embedded server not found at \(serverEntry.path).")
            }
            return
        }

        let dataDir = applicationSupportDir()
        let dbURL = "file:" + dataDir.appendingPathComponent("flavorpress.db").path

        let port: Int
        do {
            port = try findFreePort()
        } catch {
            await MainActor.run {
                self.status = .failed("No free port: \(error.localizedDescription)")
            }
            return
        }

        let logsDir = logsDirectory()
        try? FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)
        let logURL = logsDir.appendingPathComponent("server.log")
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        let logHandle = try? FileHandle(forWritingTo: logURL)
        logHandle?.seekToEndOfFile()

        let proc = Process()
        proc.executableURL = nodeBin
        proc.arguments = [serverEntry.path]
        proc.currentDirectoryURL = serverDir
        var env = ProcessInfo.processInfo.environment
        env["PORT"] = "\(port)"
        env["HOSTNAME"] = "127.0.0.1"
        env["NODE_ENV"] = "production"
        env["LIBSQL_URL"] = dbURL
        env["FLAVORPRESS_DATA_DIR"] = dataDir.path
        // WordPress one-click auth and other absolute redirects read this; without
        // it, server actions hand WP a localhost:3000 callback that won't resolve
        // back to the embedded server's random port.
        env["FLAVORPRESS_ORIGIN"] = "http://127.0.0.1:\(port)"
        // PATH augmentation for Claude Code auto-detect. Apps launched from
        // Finder inherit a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), so
        // anything managed by fnm/nvm/Homebrew/.claude/local is unreachable.
        // First try inheriting the user's login-shell PATH; that picks up
        // shell version managers transparently. Fall back to prepending
        // known install locations if the shell probe fails.
        let home = NSHomeDirectory()
        let fallbackPaths = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "\(home)/.claude/local",
            "\(home)/.npm-global/bin",
        ]
        let baselinePath = env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        let shellPath = inheritedShellPath()
        env["PATH"] = shellPath
            ?? (fallbackPaths + [baselinePath]).joined(separator: ":")
        proc.environment = env

        let stdout = Pipe()
        let stderr = Pipe()
        proc.standardOutput = stdout
        proc.standardError = stderr

        stdout.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if !data.isEmpty { logHandle?.write(data) }
        }
        stderr.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if !data.isEmpty { logHandle?.write(data) }
        }

        let banner = """
        [FlavorPress launcher] booting embedded server
          PORT=\(port)
          LIBSQL_URL=\(dbURL)
          FLAVORPRESS_ORIGIN=http://127.0.0.1:\(port)
          FLAVORPRESS_DATA_DIR=\(dataDir.path)
          server.js=\(serverEntry.path)

        """
        if let data = banner.data(using: .utf8) {
            logHandle?.write(data)
        }

        do {
            try proc.run()
        } catch {
            await MainActor.run {
                self.status = .failed("Failed to launch Node: \(error.localizedDescription)")
            }
            return
        }

        await MainActor.run {
            self.process = proc
            self.stdoutPipe = stdout
            self.stderrPipe = stderr
            self.logFileHandle = logHandle
        }

        // Poll the server until it answers, then publish the URL.
        let serverURL = URL(string: "http://127.0.0.1:\(port)")!
        let deadline = Date().addingTimeInterval(FlavorPressConfig.serverBootTimeout)
        while Date() < deadline {
            if !proc.isRunning {
                let msg = "Node exited during startup. See logs at \(logURL.path)."
                await MainActor.run { self.status = .failed(msg) }
                return
            }
            if await isReachable(url: serverURL) {
                await MainActor.run { self.status = .ready(serverURL) }
                return
            }
            try? await Task.sleep(nanoseconds: UInt64(FlavorPressConfig.serverPollInterval * 1_000_000_000))
        }
        proc.terminate()
        await MainActor.run {
            self.status = .failed("Server did not start within \(Int(FlavorPressConfig.serverBootTimeout))s. See \(logURL.path).")
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var server: EmbeddedServer

    var body: some View {
        Group {
            switch server.status {
            case .idle, .starting:
                BootView()
            case .ready(let url):
                WebView(url: url).ignoresSafeArea()
            case .failed(let message):
                FailureView(message: message)
            }
        }
    }
}

struct BootView: View {
    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text("Starting FlavorPress…")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct FailureView: View {
    let message: String

    var body: some View {
        VStack(spacing: 12) {
            Text("FlavorPress couldn't start").font(.title2).bold()
            Text(message)
                .font(.system(.body, design: .monospaced))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .foregroundStyle(.secondary)
            Button("Show Logs") {
                NSWorkspace.shared.open(logsDirectory())
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}

struct WebView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: config)
        view.allowsBackForwardNavigationGestures = true
        view.allowsMagnification = true
        view.setValue(false, forKey: "drawsBackground")
        view.load(URLRequest(url: url))

        NotificationCenter.default.addObserver(
            forName: .flavorPressReload,
            object: nil,
            queue: .main
        ) { [weak view] _ in
            view?.reload()
        }
        NotificationCenter.default.addObserver(
            forName: .flavorPressNavigate,
            object: nil,
            queue: .main
        ) { [weak view] note in
            guard let path = note.object as? String,
                  let base = view?.url,
                  let resolved = URL(string: path, relativeTo: base) else { return }
            view?.load(URLRequest(url: resolved))
        }
        return view
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        if nsView.url != url {
            nsView.load(URLRequest(url: url))
        }
    }
}

struct LaunchAtLoginToggle: View {
    @State private var enabled: Bool = SMAppService.mainApp.status == .enabled

    var body: some View {
        Toggle("Launch at Login", isOn: Binding(
            get: { enabled },
            set: { newValue in
                do {
                    if newValue {
                        try SMAppService.mainApp.register()
                    } else {
                        try SMAppService.mainApp.unregister()
                    }
                    enabled = SMAppService.mainApp.status == .enabled
                } catch {
                    NSLog("FlavorPress: launch-at-login toggle failed: \(error)")
                }
            }
        ))
    }
}

// MARK: - Helpers

func applicationSupportDir() -> URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
    let dir = base.appendingPathComponent(FlavorPressConfig.appSupportFolder)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

func logsDirectory() -> URL {
    let base = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Logs")
    let dir = base.appendingPathComponent(FlavorPressConfig.logsFolder)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

func revealDataFolder() {
    NSWorkspace.shared.activateFileViewerSelecting([applicationSupportDir()])
}

/// Best-effort: ask the user's login shell what its PATH is, so the embedded
/// Node process can find `claude` and other shell-managed binaries (fnm, nvm,
/// Homebrew). Returns nil on any failure; callers should fall back to a
/// prepended-known-locations PATH. Capped at 1.5s so a slow shell rc does not
/// block app launch.
func inheritedShellPath() -> String? {
    let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
    guard FileManager.default.isExecutableFile(atPath: shell) else { return nil }
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: shell)
    proc.arguments = ["-ilc", "printf '%s' \"$PATH\""]
    let pipe = Pipe()
    proc.standardOutput = pipe
    proc.standardError = Pipe()
    do {
        try proc.run()
    } catch {
        return nil
    }
    let deadline = Date().addingTimeInterval(1.5)
    while proc.isRunning && Date() < deadline {
        Thread.sleep(forTimeInterval: 0.05)
    }
    if proc.isRunning {
        proc.terminate()
        return nil
    }
    guard let data = try? pipe.fileHandleForReading.readToEnd(),
          let raw = String(data: data, encoding: .utf8) else { return nil }
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

func findFreePort() throws -> Int {
    let socketFD = socket(AF_INET, SOCK_STREAM, 0)
    if socketFD < 0 { throw NSError(domain: "FlavorPress", code: 1) }
    defer { close(socketFD) }

    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = 0  // Let kernel assign.
    addr.sin_addr.s_addr = in_addr_t(0x7F000001).bigEndian  // 127.0.0.1
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)

    let bindResult = withUnsafePointer(to: &addr) { ptr -> Int32 in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { addrPtr in
            bind(socketFD, addrPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    if bindResult < 0 { throw NSError(domain: "FlavorPress", code: 2) }

    var assigned = sockaddr_in()
    var size = socklen_t(MemoryLayout<sockaddr_in>.size)
    let nameResult = withUnsafeMutablePointer(to: &assigned) { ptr -> Int32 in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { addrPtr in
            getsockname(socketFD, addrPtr, &size)
        }
    }
    if nameResult < 0 { throw NSError(domain: "FlavorPress", code: 3) }

    return Int(UInt16(bigEndian: assigned.sin_port))
}

func isReachable(url: URL) async -> Bool {
    var request = URLRequest(url: url)
    request.timeoutInterval = 1
    request.httpMethod = "HEAD"
    do {
        let (_, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse {
            // Any HTTP response means the server is up; 4xx/5xx still counts.
            _ = http
            return true
        }
        return false
    } catch {
        return false
    }
}
