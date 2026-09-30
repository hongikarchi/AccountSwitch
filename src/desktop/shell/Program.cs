using System;
using System.Threading;
using System.Windows.Forms;
using Velopack;

namespace AccountSwitch.Desktop
{
    // AccountSwitch PC program: runs the app server and shows it in its own window, stays in the
    // tray (optional), starts with Windows (optional) and updates itself (Velopack).
    internal static class Program
    {
        private const string MutexName = @"Local\AccountSwitch.Desktop";
        internal const string ShowEventName = @"Local\AccountSwitch.Desktop.Show";
        internal const string QuitEventName = @"Local\AccountSwitch.Desktop.Quit";

        [STAThread]
        private static int Main(string[] args)
        {
            // Install/uninstall/update hooks run here and exit before the app starts.
            VelopackApp.Build().Run();
            bool background = Array.IndexOf(args, "--background") >= 0;
            using (var mutex = new Mutex(true, MutexName, out bool first))
            {
                if (!first)
                {
                    // Already running: bring its window forward (or ask it to quit) instead of a
                    // second server.
                    try
                    {
                        string name = Array.IndexOf(args, "--quit") >= 0 ? QuitEventName : ShowEventName;
                        using (var signal = EventWaitHandle.OpenExisting(name)) signal.Set();
                    }
                    catch (WaitHandleCannotBeOpenedException)
                    {
                        /* The first instance is still starting. */
                    }
                    return 0;
                }
                if (Array.IndexOf(args, "--quit") >= 0) return 0;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (var context = new ShellContext(background))
                    Application.Run(context);
                GC.KeepAlive(mutex);
                return 0;
            }
        }
    }
}
