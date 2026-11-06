using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace AccountSwitch.Desktop
{
    /// <summary>Tray icon, server, window and updates for one running AccountSwitch program.</summary>
    internal sealed class ShellContext : ApplicationContext
    {
        private readonly NotifyIcon tray;
        private readonly ToolStripMenuItem updateItem;
        private readonly ToolStripMenuItem autostartItem;
        private readonly ToolStripMenuItem backgroundItem;
        private readonly Engine engine = new Engine();
        private readonly EventWaitHandle showSignal;
        private readonly EventWaitHandle quitSignal;
        private readonly SynchronizationContext ui;
        private readonly System.Windows.Forms.Timer updateTimer = new System.Windows.Forms.Timer();
        private ShellForm form;
        private int restarts;
        private bool askingToQuit;
        // The tray icon this object owns; null while the shared AppIcon stands in for it.
        private Icon trayIcon;
        private bool trayShownForLightTaskbar;
        private int trayShownSize;
        private static readonly int[] TrayIconSizes = { 16, 20, 24, 32 };
        public DesktopSettings Settings { get; }
        public Updater Updater { get; }
        public bool Quitting { get; private set; }
        public static readonly Icon AppIcon = LoadIcon();

        public ShellContext(bool background)
        {
            WindowsFormsSynchronizationContext.AutoInstall = true;
            ui = new WindowsFormsSynchronizationContext();
            SynchronizationContext.SetSynchronizationContext(ui);
            Settings = DesktopSettings.Load();
            try { Settings.ApplyAutostart(Paths.Launcher); } catch { /* Policy may block the Run key. */ }
            string source = Environment.GetEnvironmentVariable("ACCOUNTSWITCH_UPDATE_SOURCE");
            Updater = new Updater(string.IsNullOrWhiteSpace(source) ? Settings.UpdateSource : source);
            Updater.Changed += () => ui.Post(_ => OnUpdateChanged(), null);

            var menu = new ContextMenuStrip();
            var open = menu.Items.Add("AccountSwitch 열기", null, (s, e) => ShowWindow());
            open.Font = new Font(open.Font, FontStyle.Bold);
            menu.Items.Add(new ToolStripSeparator());
            autostartItem = new ToolStripMenuItem("Windows 시작 시 실행", null, (s, e) => SetOption(autostart: !Settings.Autostart));
            backgroundItem = new ToolStripMenuItem("창을 닫아도 트레이에서 실행", null, (s, e) => SetOption(background: !Settings.Background));
            menu.Items.Add(autostartItem);
            menu.Items.Add(backgroundItem);
            menu.Items.Add(new ToolStripSeparator());
            updateItem = new ToolStripMenuItem("업데이트 확인", null, (s, e) => OnUpdateClick());
            menu.Items.Add(updateItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("종료", null, (s, e) => RequestQuit());
            tray = new NotifyIcon { Text = "AccountSwitch", ContextMenuStrip = menu };
            ShowTrayIcon();
            tray.Visible = true;
            tray.DoubleClick += (s, e) => ShowWindow();
            SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;
            ShowOptions();
            OnUpdateChanged();

            showSignal = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ShowEventName);
            new Thread(() =>
            {
                while (showSignal.WaitOne())
                {
                    if (Quitting) return;
                    ui.Post(_ => ShowWindow(), null);
                }
            }) { IsBackground = true }.Start();
            quitSignal = new EventWaitHandle(false, EventResetMode.AutoReset, Program.QuitEventName);
            new Thread(() =>
            {
                if (quitSignal.WaitOne() && !Quitting) ui.Post(_ => Quit(), null);
            }) { IsBackground = true }.Start();

            engine.Exited += code => ui.Post(_ => OnEngineExited(code), null);
            form = new ShellForm(this);
            if (!background) form.Show();
            _ = StartEngine();
            // Check for updates shortly after start and every six hours.
            updateTimer.Interval = 60_000;
            updateTimer.Tick += (s, e) =>
            {
                updateTimer.Interval = 6 * 60 * 60_000;
                _ = Updater.Check();
            };
            updateTimer.Start();
        }

        private async Task StartEngine()
        {
            try
            {
                string url = await engine.Start();
                form.Open(url);
            }
            catch (Exception error)
            {
                form.ShowProblem("AccountSwitch 서버를 시작하지 못했습니다: " + error.Message);
            }
        }

        private void OnEngineExited(int code)
        {
            if (Quitting) return;
            // Restart a crashed server a few times; accounts and settings are on disk.
            if (++restarts <= 3)
            {
                form.ShowProblem("AccountSwitch 서버가 종료되어 다시 시작하는 중입니다…");
                _ = StartEngine();
                return;
            }
            form.ShowProblem("AccountSwitch 서버가 계속 종료됩니다 (코드 " + code + "). 프로그램을 다시 실행하세요.");
        }

        public void ShowWindow()
        {
            if (Quitting) return;
            if (form.IsDisposed) form = new ShellForm(this);
            if (!form.Visible) form.Show();
            if (form.WindowState == FormWindowState.Minimized) form.WindowState = Settings.Maximized ? FormWindowState.Maximized : FormWindowState.Normal;
            form.Activate();
            if (engine.Url != null) form.Open(engine.Url);
        }

        /// <summary>The window closed with background mode on: keep running in the tray.</summary>
        public void Hidden()
        {
            if (Settings.TrayHintShown) return;
            Settings.TrayHintShown = true;
            Settings.Save();
            tray.ShowBalloonTip(5000, "AccountSwitch", "창을 닫아도 트레이에서 계속 실행됩니다. 끝내려면 트레이 메뉴의 종료를 누르세요.", ToolTipIcon.Info);
        }

        private void SetOption(bool? autostart = null, bool? background = null)
        {
            if (autostart.HasValue) Settings.Autostart = autostart.Value;
            if (background.HasValue) Settings.Background = background.Value;
            try
            {
                Settings.Save();
                Settings.ApplyAutostart(Paths.Launcher);
            }
            catch (Exception error)
            {
                tray.ShowBalloonTip(5000, "AccountSwitch", "설정을 저장하지 못했습니다: " + error.Message, ToolTipIcon.Warning);
            }
            ShowOptions();
        }

        private void ShowOptions()
        {
            autostartItem.Checked = Settings.Autostart;
            backgroundItem.Checked = Settings.Background;
        }

        /// <summary>
        /// The user asked to quit: while an install run is active, ask first (SPEC 3.4). The quit
        /// signal (uninstaller, updater hooks) goes straight to Quit, since nobody may be there to answer.
        /// </summary>
        public void RequestQuit(bool applyUpdate = false)
        {
            if (Quitting || askingToQuit) return;
            if (QuitGuard.ShouldAsk(File.Exists(QuitGuard.MarkerFile(Paths.Data)), engine.RunningOwn))
            {
                DialogResult answer;
                askingToQuit = true;
                try
                {
                    // Over the window when it shows; from the tray the window stays hidden.
                    var owner = form != null && !form.IsDisposed && form.Visible ? form : null;
                    answer = MessageBox.Show(
                        owner,
                        applyUpdate ? QuitGuard.UpdateQuestion : QuitGuard.QuitQuestion,
                        "AccountSwitch",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Warning,
                        MessageBoxDefaultButton.Button2);
                }
                finally
                {
                    askingToQuit = false;
                }
                // The quit signal may have ended the program while the question was open.
                if (Quitting || answer != DialogResult.Yes) return;
            }
            Quit(applyUpdate);
        }

        public void Quit(bool applyUpdate = false)
        {
            if (Quitting) return;
            Quitting = true;
            SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged;
            updateTimer.Stop();
            tray.Visible = false;
            try { form?.Close(); } catch { /* Closing anyway. */ }
            if (!engine.Attached) engine.Stop();
            showSignal.Set();
            if (applyUpdate) Updater.ApplyAndRestart();
            else Updater.ApplyAtExit();
            ExitThread();
        }

        private void OnUpdateClick()
        {
            if (Updater.State == "ready") RequestQuit(applyUpdate: true);
            else _ = Updater.Check();
        }

        private void OnUpdateChanged()
        {
            switch (Updater.State)
            {
                case "ready":
                    updateItem.Text = "재시작하여 업데이트 (" + Updater.Available + ")";
                    updateItem.Enabled = true;
                    tray.ShowBalloonTip(5000, "AccountSwitch 업데이트 준비됨", Updater.Available + " 버전을 설치할 수 있습니다. 종료하면 적용됩니다.", ToolTipIcon.Info);
                    break;
                case "checking": updateItem.Text = "업데이트 확인 중…"; updateItem.Enabled = false; break;
                case "downloading": updateItem.Text = "업데이트 내려받는 중 (" + Updater.Available + ")…"; updateItem.Enabled = false; break;
                case "current": updateItem.Text = "최신 버전 " + Paths.Version; updateItem.Enabled = true; break;
                case "unavailable": updateItem.Text = "업데이트 없음 (설치본 아님)"; updateItem.Enabled = false; break;
                case "error": updateItem.Text = "업데이트 확인 실패 · 다시 시도"; updateItem.Enabled = true; break;
                default: updateItem.Text = "업데이트 확인"; updateItem.Enabled = true; break;
            }
        }

        public static void OpenExternal(string url)
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != "https" && uri.Scheme != "http")) return;
            try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); } catch { /* No browser. */ }
        }

        // The event can arrive on another thread. Any category may matter (theme, display scale), and
        // ShowTrayIcon does nothing when neither changed, so there is no filter here.
        private void OnUserPreferenceChanged(object sender, UserPreferenceChangedEventArgs e)
        {
            ui.Post(_ => { if (!Quitting) ShowTrayIcon(); }, null);
        }

        /// <summary>Show the tray icon for the current taskbar theme and display scale.</summary>
        private void ShowTrayIcon()
        {
            bool light = TaskbarIsLight();
            int size = TrayIconSize();
            if (tray.Icon != null && light == trayShownForLightTaskbar && size == trayShownSize) return;
            Icon next = LoadTrayIcon(light, size);
            tray.Icon = next ?? AppIcon;
            // Only after the tray holds the new one. AppIcon is shared and is never disposed here.
            trayIcon?.Dispose();
            trayIcon = next;
            trayShownForLightTaskbar = light;
            trayShownSize = size;
        }

        private static bool TaskbarIsLight()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                    return key?.GetValue("SystemUsesLightTheme") is int value && value != 0;
            }
            catch
            {
                // Windows versions without this value have a dark taskbar. Either icon stays
                // legible on the wrong taskbar, since its track contrasts with any background.
                return false;
            }
        }

        // The small-icon metric follows the display scale: 16 px at 100%, 20 at 125%, 24 at 150%,
        // 32 at 200%. Above that the largest is used and Windows scales it up.
        private static int TrayIconSize()
        {
            int wanted = SystemInformation.SmallIconSize.Width;
            foreach (int size in TrayIconSizes)
                if (size >= wanted) return size;
            return TrayIconSizes[TrayIconSizes.Length - 1];
        }

        private static Icon LoadTrayIcon(bool lightTaskbar, int size)
        {
            try
            {
                using (var stream = typeof(ShellContext).Assembly.GetManifestResourceStream(lightTaskbar ? "tray-light-taskbar.ico" : "tray-dark-taskbar.ico"))
                    return stream == null ? null : new Icon(stream, size, size);
            }
            catch { return null; }
        }

        private static Icon LoadIcon()
        {
            // From the resource, which keeps every size, so the title bar gets the drawing made for
            // its size. The icon read from the exe file is one size, shrunk to fit.
            try
            {
                using (var stream = typeof(ShellContext).Assembly.GetManifestResourceStream("accountswitch.ico"))
                    if (stream != null) return new Icon(stream);
            }
            catch { /* Fall back to the exe's icon. */ }
            try { return Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application; }
            catch { return SystemIcons.Application; }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged;
                tray.Dispose();
                trayIcon?.Dispose();
                showSignal.Dispose();
                quitSignal.Dispose();
                updateTimer.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
